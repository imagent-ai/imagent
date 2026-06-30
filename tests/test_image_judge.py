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
