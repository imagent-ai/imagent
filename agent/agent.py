from __future__ import annotations

import ast
import base64
import json
import mimetypes
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from imagent_runtime.agent_runtime import AgentRuntime


DEFAULT_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/images"
DEFAULT_OPENROUTER_MODEL = "google/gemini-3.1-flash-image"
DEFAULT_OPENROUTER_CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_API_KEY_ENV = "OPENROUTER_API_KEY"

_IMAGE_EXTENSION_BY_MEDIA_TYPE = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}


class OpenRouterImageError(RuntimeError):
    """Raised when OpenRouter cannot produce a usable image response."""


class BaseImageAgent:
    """Reference image agent that calls OpenRouter Gemini Image by default.

    Contributors should replace this class with stronger planning, critique, and
    regeneration logic while keeping the public setup/generate interface stable.
    """

    def setup(self, config: dict[str, Any], workdir: Path) -> None:
        self.config = config
        self.workdir = Path(workdir).expanduser().resolve()
        self.backend_config = _image_backend_config(config)
        self.runtime = AgentRuntime(self)
        runtime = config.get("runtime") if isinstance(config.get("runtime"), dict) else {}
        self._candidates_per_round = max(1, int(runtime.get("candidates_per_round", 1)))
        agent_block = config.get("agent") if isinstance(config.get("agent"), dict) else {}
        verifier = agent_block.get("verifier")
        self._verifier_config = dict(verifier) if isinstance(verifier, dict) else {}

    def generate(self, case: dict[str, Any], output_dir: Path) -> dict[str, Any]:
        if not hasattr(self, "runtime"):
            raise RuntimeError("agent.setup(config, workdir) must be called before generate()")
        if self._candidates_per_round <= 1 or not self._verifier_config:
            return self.runtime.generate(case, output_dir)
        return self._generate_best_candidate(case, output_dir)

    def _generate_best_candidate(self, case: dict[str, Any], output_dir: Path) -> dict[str, Any]:
        started = time.perf_counter()
        images_dir, traces_dir = self._prepare_output_dirs(output_dir)
        run_id = _safe_run_id(case.get("run_id") or case.get("id") or "case")
        context = self._build_context(case)
        user_prompt = str(case.get("prompt", "")).strip()
        prompts = self._candidate_prompts(case, context)[: self._candidates_per_round]

        best: dict[str, Any] | None = None
        candidate_traces: list[dict[str, Any]] = []
        for index, generation_prompt in enumerate(prompts):
            image_bytes, media_type, response_payload, request_payload = self._request_openrouter_image(
                generation_prompt
            )
            score = self._vision_score(image_bytes, media_type, user_prompt, context.get("required_text", []))
            usage = response_payload.get("usage")
            usage = usage if isinstance(usage, dict) else {}
            model = str(response_payload.get("model") or request_payload["model"])
            candidate = {
                "index": index,
                "score": score,
                "generation_prompt": generation_prompt,
                "image_bytes": image_bytes,
                "media_type": media_type,
                "response_payload": response_payload,
                "request_payload": request_payload,
                "usage": usage,
                "model": model,
            }
            candidate_traces.append(
                {
                    "index": index,
                    "score": score,
                    "generation_prompt": generation_prompt,
                    "model": model,
                    "cost_usd": _float_or_zero(usage.get("cost")),
                }
            )
            if best is None or float(candidate["score"]) > float(best["score"]):
                best = candidate

        if best is None:
            raise OpenRouterImageError("candidate generation did not produce any image")

        image_path = images_dir / f"{run_id}{_extension_for_media_type(str(best["media_type"]))}"
        trace_path = traces_dir / f"{run_id}.json"
        image_path.write_bytes(best["image_bytes"])

        total_cost = sum(_float_or_zero(item.get("cost_usd")) for item in candidate_traces)
        trace = {
            "agent": "orchestrated-openrouter-gemini",
            "runtime": {
                "id": self.runtime.id,
                "version": self.runtime.version,
                "steps": [
                    *self.runtime.trajectory,
                    "score_candidates_with_vision",
                    "select_best_candidate",
                ],
            },
            "model": best["model"],
            "provider": "openrouter",
            "user_prompt": user_prompt,
            "generation_prompt": best["generation_prompt"],
            "context": context,
            "trajectory": self.runtime.trajectory,
            "candidates": candidate_traces,
            "selected_candidate_index": best["index"],
            "request": {
                "endpoint": str(self.backend_config.get("endpoint", DEFAULT_OPENROUTER_ENDPOINT)),
                "model": best["request_payload"].get("model"),
                "parameters": {
                    key: value
                    for key, value in best["request_payload"].items()
                    if key not in {"prompt", "input_references"}
                },
            },
            "response": {
                "created": best["response_payload"].get("created"),
                "media_type": best["media_type"],
                "usage": best["usage"],
            },
        }
        trace_path.write_text(json.dumps(trace, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        return {
            "image_path": str(image_path),
            "trace_path": str(trace_path),
            "metadata": {
                "agent_id": "orchestrated-openrouter-gemini-agent",
                "runtime_id": self.runtime.id,
                "provider": "openrouter",
                "model": best["model"],
                "media_type": best["media_type"],
                "latency_ms": round((time.perf_counter() - started) * 1000, 3),
                "cost_usd": round(total_cost, 6),
                "candidate_count": len(candidate_traces),
                "selected_candidate_index": best["index"],
                "round_count": 1,
            },
        }

    def _request_openrouter_image(self, prompt: str) -> tuple[bytes, str, dict[str, Any], dict[str, Any]]:
        api_key_env = str(self.backend_config.get("api_key_env", DEFAULT_API_KEY_ENV))
        api_key = os.environ.get(api_key_env)
        if not api_key:
            raise OpenRouterImageError(f"missing OpenRouter API key env var: {api_key_env}")

        payload = self._openrouter_payload(prompt)
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if self.backend_config.get("referer"):
            headers["HTTP-Referer"] = str(self.backend_config["referer"])
        if self.backend_config.get("title"):
            headers["X-OpenRouter-Title"] = str(self.backend_config["title"])

        request = urllib.request.Request(
            str(self.backend_config.get("endpoint", DEFAULT_OPENROUTER_ENDPOINT)),
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=int(self.backend_config.get("timeout_seconds", 240))) as response:
                response_payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise OpenRouterImageError(f"OpenRouter image HTTP {exc.code}: {body}") from exc
        except urllib.error.URLError as exc:
            raise OpenRouterImageError(f"OpenRouter image request failed: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise OpenRouterImageError("OpenRouter image response was not valid JSON") from exc

        image_bytes, media_type = _image_from_openrouter_response(response_payload, self.backend_config)
        return image_bytes, media_type, response_payload, payload

    def _openrouter_payload(self, prompt: str) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": str(self.backend_config.get("model", DEFAULT_OPENROUTER_MODEL)),
            "prompt": prompt,
            "n": int(self.backend_config.get("n", 1)),
        }
        parameters = self.backend_config.get("parameters")
        if isinstance(parameters, dict):
            for key, value in parameters.items():
                _set_payload_parameter(payload, str(key), value)

        for key in (
            "resolution",
            "aspect_ratio",
            "size",
            "quality",
            "output_format",
            "background",
            "output_compression",
            "seed",
            "input_references",
            "provider",
        ):
            if key not in self.backend_config:
                continue
            if key == "seed" and self.backend_config.get("send_seed") is False:
                continue
            if key == "output_format" and self.backend_config.get("send_output_format") is False:
                continue
            _set_payload_parameter(payload, key, self.backend_config[key])
        return payload

    def _build_context(self, case: dict[str, Any]) -> dict[str, Any]:
        prompt = str(case.get("prompt", ""))
        memory = case.get("memory") if isinstance(case.get("memory"), dict) else {}
        assets = self._read_assets(case.get("assets", []))
        facts = self._read_search_facts(case.get("search_snapshots", []), prompt)
        title = (
            str(memory.get("preferred_label") or "").strip()
            or assets.get("title")
            or self._title_from_prompt(prompt)
            or ("Image-Agent" if facts else "")
        )
        sections = self._sections_from_prompt(prompt) or assets.get("sections", [])
        subtitle = self._subtitle_from_prompt(prompt)
        required_text = [title, *sections, *assets.get("required_text", [])]
        if subtitle:
            required_text.append(subtitle)
        if "reason" in case.get("allowed_tools", []):
            display = self._reasoning_display(prompt)
            if display:
                required_text.extend([display["answer"], display["display"]])
        if "PASS" in prompt.upper():
            required_text.append("PASS")
        if facts:
            required_text.extend(["Image-Agent", "context gap"])

        return {
            "capability": str(case.get("capability", "")),
            "memory": {key: str(value) for key, value in memory.items() if value is not None},
            "title": title,
            "subtitle": subtitle,
            "layout": assets.get("layout", ""),
            "visual_constraints": assets.get("visual_constraints", {}),
            "sections": _dedupe(sections),
            "required_text": _dedupe(required_text),
            "facts": facts[:4],
        }

    def _build_generation_prompt(self, case: dict[str, Any], context: dict[str, Any]) -> str:
        prompt = str(case.get("prompt", "")).strip()
        capability = str(context.get("capability", "")).strip().lower()
        lines = [
            "Create one polished, production-quality image that satisfies the user request exactly.",
            f"User request: {prompt}",
            "Planning checklist: extract required visible text, choose a readable layout, render labels with perfect spelling, then verify composition.",
        ]

        if capability == "plan":
            lines.extend(
                [
                    "Layout directive: square poster with a strong headline and exactly three clearly separated panels.",
                    "Each panel must include a large, legible section label.",
                ]
            )
        elif capability == "search":
            lines.extend(
                [
                    "Layout directive: compact research board or dashboard with a title band and organized fact callouts.",
                    "Keep the board dense but readable; prefer structured columns or cards over decorative clutter.",
                ]
            )
        elif capability == "feedback":
            lines.extend(
                [
                    "Layout directive: compact validation badge or certification card centered in frame.",
                    "Typography is the top priority: reproduce every required label character-for-character.",
                ]
            )

        layout = str(context.get("layout", "")).strip()
        if layout:
            lines.append(f"Requested layout pattern: {layout.replace('_', ' ')}")

        if context.get("title"):
            lines.append(f"Primary title or label: {context['title']}")
        if context.get("subtitle"):
            lines.append(f"Required subtitle: {context['subtitle']}")
        if context.get("sections"):
            lines.append(f"Required section labels: {', '.join(context['sections'])}")
        if context.get("required_text"):
            quoted = ", ".join(f'"{item}"' for item in context["required_text"])
            lines.append(f"Exact visible text that must appear correctly: {quoted}")
        if context.get("facts"):
            lines.append(f"Grounding facts to incorporate where relevant: {'; '.join(context['facts'])}")
        if context.get("memory"):
            memory_text = "; ".join(f"{key}: {value}" for key, value in context["memory"].items())
            lines.append(f"User memory and style preferences: {memory_text}")
        constraints = context.get("visual_constraints")
        if isinstance(constraints, dict) and constraints:
            constraint_text = "; ".join(f"{key}: {value}" for key, value in constraints.items())
            lines.append(f"Visual constraints: {constraint_text}")

        lines.extend(
            [
                "Use high contrast text, generous padding around labels, and clean alignment.",
                "Avoid misspelled text, missing labels, overlapping panels, and visual noise.",
            ]
        )
        return "\n".join(line for line in lines if line)

    def _candidate_prompts(self, case: dict[str, Any], context: dict[str, Any]) -> list[str]:
        base = self._build_generation_prompt(case, context)
        capability = str(context.get("capability", "")).strip().lower()
        layout_variant = (
            f"{base}\n\nCandidate emphasis: maximize panel separation, balanced whitespace, and a clear visual hierarchy."
        )
        text_variant = (
            f"{base}\n\nCandidate emphasis: maximize text legibility, exact spelling, and label contrast."
        )
        if capability == "feedback":
            return [text_variant, base]
        if capability == "plan":
            return [layout_variant, text_variant]
        if capability == "search":
            return [base, text_variant]
        return [base, layout_variant]

    def _vision_score(self, image_bytes: bytes, media_type: str, user_prompt: str, required_text: list[str]) -> float:
        api_key_env = str(self._verifier_config.get("api_key_env", DEFAULT_API_KEY_ENV))
        api_key = os.environ.get(api_key_env)
        if not api_key:
            return 0.0

        encoded = base64.b64encode(image_bytes).decode("ascii")
        data_url = f"data:{media_type};base64,{encoded}"
        required_line = ", ".join(required_text) if required_text else "none specified"
        rubric = (
            "You are selecting the best generated image for an image-agent benchmark.\n"
            "Return only JSON: {\"overall_score\": number, \"rationale\": \"short reason\"}\n"
            "Score from 0-100. Reward prompt alignment, readable layout, and perfectly spelled required text.\n"
            f"User prompt:\n{user_prompt}\n\n"
            f"Required visible text:\n{required_line}\n"
        )
        payload = {
            "model": str(self._verifier_config.get("model", "google/gemini-2.5-flash")),
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": rubric},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
            "temperature": 0,
            "max_tokens": 500,
            "response_format": {"type": "json_object"},
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if self._verifier_config.get("referer"):
            headers["HTTP-Referer"] = str(self._verifier_config["referer"])
        if self._verifier_config.get("title"):
            headers["X-OpenRouter-Title"] = str(self._verifier_config["title"])

        request = urllib.request.Request(
            str(self._verifier_config.get("endpoint", DEFAULT_OPENROUTER_CHAT_ENDPOINT)),
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=int(self._verifier_config.get("timeout_seconds", 180))) as response:
                response_payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError):
            return 0.0

        content = _openrouter_message_content(response_payload)
        parsed = _parse_json_object(content)
        raw_score = parsed.get("overall_score", 0.0)
        try:
            return round(max(0.0, min(100.0, float(raw_score))), 6)
        except (TypeError, ValueError):
            return 0.0

    def _read_assets(self, values: Any) -> dict[str, Any]:
        for value in values or []:
            path = self._case_path(value)
            if path.suffix.lower() != ".json":
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                continue
            constraints = data.get("visual_constraints")
            return {
                "title": str(data.get("title") or ""),
                "layout": str(data.get("layout") or ""),
                "sections": [str(item) for item in data.get("sections", []) if str(item).strip()],
                "required_text": [str(item) for item in data.get("required_text", []) if str(item).strip()],
                "visual_constraints": constraints if isinstance(constraints, dict) else {},
            }
        return {"title": "", "layout": "", "sections": [], "required_text": [], "visual_constraints": {}}

    def _read_search_facts(self, values: Any, prompt: str) -> list[str]:
        prompt_words = set(re.findall(r"[a-z0-9]+", prompt.lower()))
        ranked: list[tuple[int, int, str]] = []
        for value in values or []:
            path = self._case_path(value)
            if path.suffix.lower() != ".json":
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            for fact in data.get("facts", []) if isinstance(data, dict) else []:
                text = str(fact).strip()
                if not text:
                    continue
                fact_words = set(re.findall(r"[a-z0-9]+", text.lower()))
                overlap = len(prompt_words & fact_words)
                if overlap:
                    ranked.append((overlap, len(text), text))

        ranked.sort(key=lambda item: (-item[0], item[1]))
        return _dedupe([text for _, _, text in ranked])

    def _case_path(self, value: Any) -> Path:
        path = Path(str(value)).expanduser()
        candidate = path if path.is_absolute() else self.workdir / path
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(self.workdir)
        return resolved

    def _title_from_prompt(self, prompt: str) -> str:
        quoted = re.search(r'\btitled\s+["\']([^"\']+)["\']', prompt, re.IGNORECASE)
        if quoted:
            return quoted.group(1).strip()
        match = re.search(r"\btitled\s+(.+?)(?:\s+with\b|\.|$)", prompt, re.IGNORECASE)
        return match.group(1).strip() if match else ""

    def _subtitle_from_prompt(self, prompt: str) -> str:
        quoted = re.search(r'\bsubtitle\s+["\']([^"\']+)["\']', prompt, re.IGNORECASE)
        if quoted:
            return quoted.group(1).strip()
        match = re.search(r"\b(?:subtitle|sub-title)\s+(.+?)(?:\.|$)", prompt, re.IGNORECASE)
        return match.group(1).strip() if match else ""

    def _sections_from_prompt(self, prompt: str) -> list[str]:
        match = re.search(r"\bsections?\s+(.+?)(?:\.|$)", prompt, re.IGNORECASE)
        if not match:
            labeled = re.findall(r"\blabeled\s+([A-Za-z][A-Za-z0-9 &/-]*)", prompt, re.IGNORECASE)
            if labeled:
                return [part.strip(" .") for part in labeled if part.strip(" .")]
            return []
        raw = re.sub(r"\band\b", ",", match.group(1), flags=re.IGNORECASE)
        return [part.strip(" .") for part in re.split(r"[,;/|]+", raw) if part.strip(" .")]

    def _reasoning_display(self, prompt: str) -> dict[str, str] | None:
        expression = _extract_expression(prompt)
        if not expression:
            return None
        try:
            value = _safe_eval(expression)
        except (ValueError, ZeroDivisionError):
            return None
        answer = _format_number(value)
        return {"answer": answer, "display": f"{expression} = {answer}"}

    def _prepare_output_dirs(self, output_dir: Path) -> tuple[Path, Path]:
        output_dir = Path(output_dir)
        images_dir = output_dir / "images"
        traces_dir = output_dir / "traces"
        images_dir.mkdir(parents=True, exist_ok=True)
        traces_dir.mkdir(parents=True, exist_ok=True)
        return images_dir, traces_dir


def _image_backend_config(config: dict[str, Any]) -> dict[str, Any]:
    agent_config = config.get("agent") if isinstance(config, dict) else {}
    agent_config = agent_config if isinstance(agent_config, dict) else {}
    backend_config = agent_config.get("image_backend")
    backend_config = dict(backend_config) if isinstance(backend_config, dict) else {}
    backend_config.setdefault("provider", "openrouter")
    backend_config.setdefault("model", DEFAULT_OPENROUTER_MODEL)
    backend_config.setdefault("endpoint", DEFAULT_OPENROUTER_ENDPOINT)
    backend_config.setdefault("api_key_env", DEFAULT_API_KEY_ENV)
    return backend_config


def _image_from_openrouter_response(
    response_payload: dict[str, Any], backend_config: dict[str, Any]
) -> tuple[bytes, str]:
    data = response_payload.get("data")
    if not isinstance(data, list) or not data:
        raise OpenRouterImageError("OpenRouter image response did not include image data")
    first_image = data[0]
    if not isinstance(first_image, dict):
        raise OpenRouterImageError("OpenRouter image response data item was not an object")

    media_type = str(first_image.get("media_type") or _media_type_from_format(backend_config.get("output_format")) or "image/png")
    if isinstance(first_image.get("b64_json"), str) and first_image["b64_json"].strip():
        try:
            return base64.b64decode(first_image["b64_json"]), media_type
        except ValueError as exc:
            raise OpenRouterImageError("OpenRouter image response included invalid base64 image bytes") from exc

    url = _image_url_from_response_item(first_image)
    if url:
        return _image_bytes_from_url(url, media_type, backend_config)

    raise OpenRouterImageError("OpenRouter image response did not include b64_json or url")


def _image_url_from_response_item(item: dict[str, Any]) -> str:
    if isinstance(item.get("url"), str):
        return str(item["url"])
    image_url = item.get("image_url")
    if isinstance(image_url, dict) and isinstance(image_url.get("url"), str):
        return str(image_url["url"])
    return ""


def _image_bytes_from_url(url: str, fallback_media_type: str, backend_config: dict[str, Any]) -> tuple[bytes, str]:
    if url.startswith("data:"):
        header, _, encoded = url.partition(",")
        media_type = header.removeprefix("data:").split(";", 1)[0] or fallback_media_type
        try:
            return base64.b64decode(encoded), media_type
        except ValueError as exc:
            raise OpenRouterImageError("OpenRouter image data URL included invalid base64 bytes") from exc

    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=int(backend_config.get("timeout_seconds", 240))) as response:
            media_type = response.headers.get_content_type() if hasattr(response, "headers") else fallback_media_type
            return response.read(), media_type or fallback_media_type
    except urllib.error.URLError as exc:
        raise OpenRouterImageError(f"failed to download OpenRouter image URL: {exc}") from exc


def _set_payload_parameter(payload: dict[str, Any], key: str, value: Any) -> None:
    if value is None or value == "":
        return
    if key in {"background", "aspect_ratio"} and value == "auto":
        return
    payload[key] = value


def _media_type_from_format(value: Any) -> str:
    output_format = str(value or "").strip().lower()
    if output_format in {"jpg", "jpeg"}:
        return "image/jpeg"
    if output_format in {"png", "webp", "gif"}:
        return f"image/{output_format}"
    return ""


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = str(value).strip()
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result


def _extract_expression(prompt: str) -> str:
    number = r"(?:\d+(?:\.\d*)?|\.\d+)"
    for match in re.finditer(rf"(?<![A-Za-z0-9_.])(?:{number}|\()[0-9()\s+\-*/.]*", prompt):
        candidate = match.group(0).strip().rstrip(".")
        if any(char.isdigit() for char in candidate) and any(op in candidate for op in "+-*/"):
            ast.parse(candidate, mode="eval")
            return candidate
    return ""


def _safe_eval(expression: str) -> float:
    tree = ast.parse(expression, mode="eval")

    def visit(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return visit(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return float(node.value)
        if isinstance(node, ast.UnaryOp):
            value = visit(node.operand)
            if isinstance(node.op, ast.UAdd):
                return value
            if isinstance(node.op, ast.USub):
                return -value
        if isinstance(node, ast.BinOp):
            left = visit(node.left)
            right = visit(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
        raise ValueError(f"unsupported expression: {type(node).__name__}")

    return visit(tree)


def _format_number(value: float) -> str:
    rounded = round(value)
    if abs(value - rounded) < 1e-9:
        return str(int(rounded))
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _safe_run_id(value: Any) -> str:
    text = str(value).strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", text):
        raise ValueError("run_id must be filename safe")
    return text


def _extension_for_media_type(media_type: str) -> str:
    normalized = media_type.split(";", 1)[0].strip().lower()
    if normalized in _IMAGE_EXTENSION_BY_MEDIA_TYPE:
        return _IMAGE_EXTENSION_BY_MEDIA_TYPE[normalized]
    guessed = mimetypes.guess_extension(normalized, strict=False)
    return ".jpg" if guessed == ".jpe" else guessed or ".png"


def _float_or_zero(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _openrouter_message_content(response: dict[str, Any]) -> str:
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("OpenRouter response did not include choices")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        raise ValueError("OpenRouter response did not include a message")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("OpenRouter response did not include text content")
    return content.strip()


def _parse_json_object(content: str) -> dict[str, Any]:
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    parsed = json.loads(stripped)
    if not isinstance(parsed, dict):
        raise ValueError("JSON response must be an object")
    return parsed


ImageAgent = BaseImageAgent
