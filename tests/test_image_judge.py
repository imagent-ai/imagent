from __future__ import annotations

import json
from pathlib import Path

from imagent_bench.evaluators.checklist import evaluate_case
from imagent_bench.evaluators.judge import OpenAIImageJudge


def test_openai_image_judge_fails_closed_without_api_key(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    image_path = tmp_path / "image.svg"
    trace_path = tmp_path / "trace.json"
    image_path.write_text("<svg><text>PASS</text></svg>", encoding="utf-8")
    trace_path.write_text(
        json.dumps(
            {
                "planning": {"missing_context": ["verification target"]},
                "grounding": {"reason": [], "search": [], "memory": []},
                "final_generation_context": {"prompt": "PASS"},
                "feedback": [],
            }
        ),
        encoding="utf-8",
    )
    case = {
        "id": "judge-001",
        "capability": "feedback",
        "prompt": "Create a badge with PASS.",
        "expected": {
            "checks": [
                {"type": "image_contains", "value": "PASS"},
            ]
        },
    }
    output = {"image_path": str(image_path), "trace_path": str(trace_path), "metadata": {}}
    judge = OpenAIImageJudge(
        {
            "evaluation": {
                "image_judge": {
                    "provider": "openai",
                    "model": "gpt-5.5",
                    "fail_closed": True,
                }
            }
        },
        tmp_path,
    )

    evaluation = evaluate_case(case, output, tmp_path, image_judge=judge)

    assert evaluation["passed"] is False
    assert evaluation["checks"][0]["provider"] == "openai"
    assert "OPENAI_API_KEY" in evaluation["checks"][0]["reason"]


def _openai_case_and_output(tmp_path: Path) -> tuple[dict, dict]:
    image_path = tmp_path / "image.svg"
    trace_path = tmp_path / "trace.json"
    image_path.write_text("<svg><text>PASS</text></svg>", encoding="utf-8")
    trace_path.write_text(
        json.dumps(
            {
                "planning": {"missing_context": ["verification target"]},
                "grounding": {"reason": [], "search": [], "memory": []},
                "final_generation_context": {"prompt": "PASS"},
                "feedback": [],
            }
        ),
        encoding="utf-8",
    )
    case = {
        "id": "judge-001",
        "capability": "feedback",
        "prompt": "Create a badge with PASS.",
        "expected": {"checks": [{"type": "image_contains", "value": "PASS"}]},
    }
    output = {"image_path": str(image_path), "trace_path": str(trace_path), "metadata": {}}
    return case, output


def test_openai_request_payload_uses_responses_api(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    case, output = _openai_case_and_output(tmp_path)
    judge = OpenAIImageJudge(
        {
            "evaluation": {
                "image_judge": {
                    "provider": "openai",
                    "model": "gpt-5.5",
                    "max_output_tokens": 800,
                    "reasoning_effort": "low",
                }
            }
        },
        tmp_path,
    )

    captured: dict = {}

    def fake_post(payload: dict) -> dict:
        captured["payload"] = payload
        return {"output_text": json.dumps({"checks": [{"index": 0, "passed": True, "reason": "shows PASS"}]})}

    monkeypatch.setattr(judge, "_post_json", fake_post)

    evaluation = evaluate_case(case, output, tmp_path, image_judge=judge)

    payload = captured["payload"]
    # OpenAI judge uses the Responses API, not Chat Completions.
    assert "input" in payload
    assert "messages" not in payload
    assert payload["text"]["format"]["type"] == "json_schema"
    assert payload["max_output_tokens"] == 800
    assert payload["reasoning"] == {"effort": "low"}
    content = payload["input"][0]["content"]
    assert any(part["type"] == "input_image" for part in content)

    # Verdict is parsed from Responses-API output text.
    assert evaluation["passed"] is True
    assert evaluation["checks"][0]["provider"] == "openai"


def test_openai_judge_parses_failed_verdict(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    case, output = _openai_case_and_output(tmp_path)
    judge = OpenAIImageJudge(
        {"evaluation": {"image_judge": {"provider": "openai", "model": "gpt-5.5"}}},
        tmp_path,
    )

    monkeypatch.setattr(
        judge,
        "_post_json",
        lambda payload: {
            "output_text": json.dumps({"checks": [{"index": 0, "passed": False, "reason": "no PASS visible"}]})
        },
    )

    evaluation = evaluate_case(case, output, tmp_path, image_judge=judge)

    assert evaluation["passed"] is False
    assert evaluation["checks"][0]["reason"] == "no PASS visible"
