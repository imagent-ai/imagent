from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any

try:
    from .common import ArithmeticEvaluator, dedupe_strings, format_number, keywords
    from .constants import DEFAULT_STYLE, DEFAULT_TITLE_BY_CAPABILITY, MEMORY_VISUAL_KEYS
    from .tooling import GroundingBundle, build_grounding_tools
except ImportError:  # pragma: no cover - manifest loader imports modules outside a package
    from common import ArithmeticEvaluator, dedupe_strings, format_number, keywords
    from constants import DEFAULT_STYLE, DEFAULT_TITLE_BY_CAPABILITY, MEMORY_VISUAL_KEYS
    from tooling import GroundingBundle, build_grounding_tools


class GroundingMixin:
    def _build_grounding_bundle(self, case: dict[str, Any]) -> GroundingBundle:
        grounding: dict[str, list[dict[str, Any]]] = {"asset": [], "reason": [], "search": [], "memory": []}
        tool_calls: list[dict[str, Any]] = []
        for tool in build_grounding_tools():
            if not tool.should_run(case):
                continue
            outputs = tool.run(self, case)
            grounding[tool.name] = outputs
            tool_calls.append(tool.build_call(case, outputs))
        return GroundingBundle(grounding=grounding, tool_calls=tool_calls)

    def _build_grounding(self, case: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
        return self._build_grounding_bundle(case).grounding

    def _build_generation_spec(
        self,
        case: dict[str, Any],
        grounding: dict[str, list[dict[str, Any]]],
    ) -> dict[str, Any]:
        prompt = str(case["prompt"])
        capability = str(case.get("capability", "unknown"))
        asset_entry = grounding["asset"][0] if grounding["asset"] else {}
        memory_entry = grounding["memory"][0] if grounding["memory"] else {}
        search_entries = grounding["search"]
        reasoning_entry = grounding["reason"][0] if grounding["reason"] else {}

        title = (
            memory_entry.get("mapped_title")
            or self._title_from_prompt(prompt)
            or asset_entry.get("title")
            or (search_entries[0].get("title") if search_entries else None)
            or DEFAULT_TITLE_BY_CAPABILITY.get(capability, "Image Agent")
        )
        layout = self._layout_from_prompt(prompt, str(asset_entry.get("layout", "card")))
        style = str(memory_entry.get("mapped_style") or DEFAULT_STYLE)
        asset_sections = [str(section) for section in asset_entry.get("sections", [])]
        sections = self._section_labels(prompt, asset_sections) if layout == "three_panel" else asset_sections[:3]
        grounded_facts = [str(item["fact"]) for item in search_entries[:3]]
        visual_constraints = dict(asset_entry.get("visual_constraints", {}))
        visual_constraints.update(memory_entry.get("visual_constraints", {}))
        if sections:
            visual_constraints["sections"] = sections

        visible_text: list[str] = []
        visible_text.extend(str(value) for value in asset_entry.get("visible_text", [])[:6])
        if sections:
            visible_text.extend(sections)
        if reasoning_entry.get("display"):
            visible_text.append(str(reasoning_entry["display"]))
        if capability == "search":
            visible_text.extend(grounded_facts[:3])
        if "PASS" in prompt.upper():
            visible_text.append("PASS")

        must_include: list[str] = [str(title)]
        must_include.extend(str(value) for value in asset_entry.get("exact_strings", [])[:6])
        if sections:
            must_include.extend(str(section) for section in sections)
        if reasoning_entry.get("answer"):
            must_include.append(str(reasoning_entry["answer"]))
        if capability == "search":
            if search_entries:
                must_include.append(str(search_entries[0].get("title", title)))
            if any("context gap" in fact.lower() for fact in grounded_facts):
                must_include.append("context gap")
        if "PASS" in prompt.upper():
            must_include.append("PASS")

        avoid = ["Do not omit any required visible strings."]
        if capability == "reason":
            avoid.append("Do not change the arithmetic answer.")
        if capability == "search":
            avoid.append("Do not replace grounded facts with unsupported claims.")
        if capability == "feedback":
            avoid.append("Do not paraphrase the exact validation label.")
        if asset_entry:
            avoid.append("Do not ignore values from the provided asset.")

        return {
            "title": str(title),
            "visible_text": dedupe_strings(visible_text),
            "layout": layout,
            "style": style,
            "must_include": dedupe_strings(must_include),
            "avoid": dedupe_strings(avoid),
            "reasoning_result": reasoning_entry or {},
            "grounded_facts": grounded_facts,
            "visual_constraints": visual_constraints,
        }

    def _missing_context(self, case: dict[str, Any]) -> list[str]:
        missing = {
            "plan": ["layout details", "section ordering", "visual hierarchy"],
            "reason": ["derived answer", "calculation steps"],
            "search": ["frozen factual reference", "source facts"],
            "memory": ["user preference", "saved style"],
            "feedback": ["verification target", "exact output constraints"],
        }.get(case.get("capability"), ["generation context"])
        if case.get("assets"):
            missing = list(missing) + ["provided asset values"]
        return dedupe_strings(list(missing))

    def _content_plan(self, spec: dict[str, Any]) -> dict[str, Any]:
        return {
            "layout": spec["layout"],
            "style": spec["style"],
            "text_policy": "preserve required visible labels exactly",
            "must_include_count": len(spec["must_include"]),
        }

    def _reason(self, case: dict[str, Any]) -> list[dict[str, Any]]:
        if "reason" not in case.get("allowed_tools", []):
            return []
        prompt = str(case["prompt"])
        expression = self._extract_expression(prompt)
        if not expression:
            return [
                {
                    "type": "reasoning",
                    "source": "local-arithmetic-parser",
                    "answer": "",
                    "rationale": "No arithmetic expression detected.",
                    "display": "No arithmetic expression detected.",
                }
            ]
        try:
            value = self._evaluate_expression(expression)
        except (ValueError, ZeroDivisionError) as exc:
            return [
                {
                    "type": "reasoning",
                    "source": "local-arithmetic-parser",
                    "expression": expression,
                    "answer": "",
                    "rationale": f"Could not evaluate {expression}: {exc}.",
                    "display": f"Could not evaluate {expression}",
                }
            ]
        answer = format_number(value)
        return [
            {
                "type": "reasoning",
                "source": "local-arithmetic-parser",
                "expression": expression,
                "answer": answer,
                "rationale": f"Computed {expression} = {answer}.",
                "display": f"{expression} = {answer}",
            }
        ]

    def _extract_expression(self, prompt: str) -> str | None:
        candidates: list[str] = []
        number = r"(?:\d+(?:\.\d*)?|\.\d+)"
        for match in re.finditer(rf"(?<![A-Za-z0-9_.])(?:{number}|\()[0-9()\s+\-*/.]*", prompt):
            cleaned = match.group(0).strip().rstrip(".")
            if not cleaned or not any(character.isdigit() for character in cleaned):
                continue
            if not any(operator in cleaned for operator in "+-*/"):
                continue
            candidates.append(cleaned)
        if not candidates:
            return None
        for candidate in sorted(candidates, key=len, reverse=True):
            try:
                ast.parse(candidate, mode="eval")
            except SyntaxError:
                continue
            return candidate
        return None

    def _evaluate_expression(self, expression: str) -> float:
        tree = ast.parse(expression, mode="eval")
        return ArithmeticEvaluator().visit(tree)

    def _search(self, case: dict[str, Any]) -> list[dict[str, Any]]:
        if "search" not in case.get("allowed_tools", []):
            return []

        ranked: list[dict[str, Any]] = []
        prompt_keywords = keywords(str(case["prompt"]))
        for snapshot_index, snapshot in enumerate(case.get("search_snapshots", [])):
            path = self._resolve_case_path(snapshot)
            data = self._read_case_json(path, "search snapshot")
            title = str(data.get("title", ""))
            title_keywords = keywords(title)
            facts = data.get("facts", [])
            facts = facts if isinstance(facts, list) else []
            for fact_index, fact in enumerate(facts):
                fact_text = str(fact)
                fact_keywords = keywords(fact_text)
                score = (10 * len(prompt_keywords & fact_keywords)) + (5 * len(title_keywords & fact_keywords))
                ranked.append(
                    {
                        "query": case["prompt"],
                        "source": str(path),
                        "title": title,
                        "fact": fact_text,
                        "score": score,
                        "snapshot_index": snapshot_index,
                        "fact_index": fact_index,
                    }
                )

        ranked.sort(key=lambda item: (-int(item["score"]), int(item["snapshot_index"]), int(item["fact_index"])))
        return [item for item in ranked if int(item["score"]) > 0][:3]

    def _assets(self, case: dict[str, Any]) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for asset in case.get("assets", []) or []:
            path = self._resolve_case_path(asset)
            suffix = path.suffix.lower()
            if suffix == ".json":
                data = self._read_case_json(path, "asset")
                entries.append(self._json_asset_entry(path, data))
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            lines = [line.strip(" #-") for line in text.splitlines() if line.strip()]
            title = lines[0] if lines else path.stem.replace("_", " ").title()
            entries.append(
                {
                    "type": "asset",
                    "source": str(path),
                    "title": title,
                    "layout": "",
                    "sections": [],
                    "exact_strings": dedupe_strings(lines[:4]),
                    "visible_text": dedupe_strings(lines[1:5]),
                    "visual_constraints": {},
                }
            )
        return entries

    def _json_asset_entry(self, path: Path, data: dict[str, Any]) -> dict[str, Any]:
        title = str(data.get("title") or path.stem.replace("_", " ").title())
        sections = self._asset_string_list(data.get("sections"))
        required_text = self._asset_string_list(data.get("required_text"))
        highlights = self._asset_string_list(data.get("highlights"))
        items = self._asset_item_lines(data.get("items"))
        exact_strings = dedupe_strings([title] + sections + required_text)
        visible_text = dedupe_strings(required_text + highlights + items + sections)
        visual_constraints = data.get("visual_constraints", {})
        if not isinstance(visual_constraints, dict):
            visual_constraints = {}
        layout = str(data.get("layout", ""))
        return {
            "type": "asset",
            "source": str(path),
            "title": title,
            "layout": layout,
            "sections": sections,
            "exact_strings": exact_strings,
            "visible_text": visible_text,
            "visual_constraints": visual_constraints,
        }

    def _asset_string_list(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    def _asset_item_lines(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        lines: list[str] = []
        for item in value:
            if isinstance(item, str):
                cleaned = item.strip()
                if cleaned:
                    lines.append(cleaned)
                continue
            if isinstance(item, dict):
                label = str(item.get("label", "")).strip()
                text = str(item.get("text", "")).strip()
                value_text = str(item.get("value", "")).strip()
                if label and value_text:
                    lines.append(f"{label}: {value_text}")
                elif label and text:
                    lines.append(f"{label}: {text}")
                elif text:
                    lines.append(text)
        return lines

    def _memory(self, case: dict[str, Any]) -> list[dict[str, Any]]:
        if "memory" not in case.get("allowed_tools", []):
            return []
        memory = case.get("memory", {})
        if not memory:
            return []

        visual_constraints: dict[str, Any] = {}
        unmapped: dict[str, Any] = {}
        for key, value in memory.items():
            if key in {"preferred_label", "preferred_style"}:
                continue
            if key in MEMORY_VISUAL_KEYS:
                visual_constraints[key] = value
            else:
                unmapped[key] = value

        return [
            {
                "type": "user_profile",
                "values": memory,
                "mapped_title": memory.get("preferred_label"),
                "mapped_style": memory.get("preferred_style"),
                "visual_constraints": visual_constraints,
                "unmapped": unmapped,
            }
        ]

    def _resolve_case_path(self, value: Any) -> Path:
        raw_path = Path(str(value)).expanduser()
        candidate = raw_path if raw_path.is_absolute() else self.workdir / raw_path
        try:
            resolved = candidate.resolve(strict=True)
        except FileNotFoundError as exc:
            raise FileNotFoundError(f"case path does not exist: {raw_path}") from exc
        root = self.workdir.resolve(strict=False)
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"case path escapes workdir: {raw_path}") from exc
        if not resolved.is_file():
            raise ValueError(f"case path must be a file: {raw_path}")
        return resolved

    def _read_case_json(self, path: Path, label: str) -> dict[str, Any]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"{label} must be valid JSON: {path}") from exc
        if not isinstance(data, dict):
            raise ValueError(f"{label} JSON must be an object: {path}")
        return data

    def _layout_from_prompt(self, prompt: str, default: str = "card") -> str:
        lowered = prompt.lower()
        if "three-panel" in lowered or "three panel" in lowered:
            return "three_panel"
        if "badge" in lowered:
            return "badge"
        return default or "card"

    def _title_from_prompt(self, prompt: str) -> str | None:
        for keyword in ("titled", "about"):
            title = self._phrase_after_keyword(prompt, keyword)
            if title:
                return title
        return None

    def _phrase_after_keyword(self, prompt: str, keyword: str) -> str | None:
        match = re.search(rf"\b{re.escape(keyword)}\s+(.+)", prompt, flags=re.IGNORECASE)
        if not match:
            return None
        tail = match.group(1).strip()
        if not tail:
            return None
        if tail[0] in {"'", '"'}:
            end = tail.find(tail[0], 1)
            if end > 1:
                value = tail[1:end].strip()
                return value if any(character.isalnum() for character in value) else None
        value = re.split(
            r"\s+(?:with|using|from|based on)\b",
            tail,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        value = value.strip().strip("'\"").rstrip(".!?").strip()
        if not any(character.isalnum() for character in value):
            return None
        return value

    def _section_labels(self, prompt: str, fallback: list[str] | None = None) -> list[str]:
        match = re.search(r"\bsections?\s+(.+)", prompt, flags=re.IGNORECASE)
        if not match:
            return fallback or ["Plan", "Ground", "Verify"]
        raw = re.split(
            r"\s+(?:with|using|from|based on)\b|[.!?]",
            match.group(1),
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        raw = re.sub(r"\band\b", ",", raw, flags=re.IGNORECASE)
        parts = [part.strip(" .-") for part in re.split(r"[,;/|]+", raw)]
        sections = [part for part in parts if part]
        return sections or fallback or ["Plan", "Ground", "Verify"]
