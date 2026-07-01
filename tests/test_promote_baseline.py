from __future__ import annotations

import json
from pathlib import Path

import pytest

from imagent_bench.promote_baseline import promote
from imagent_bench.runner import run


def test_promote_writes_latest_and_history(tmp_path: Path) -> None:
    result = run(Path("configs/image-agent-smoke.yaml").resolve(), "agent", tmp_path / "run")
    promoted = promote(tmp_path / "run" / "results.json", tmp_path / "baseline", "abcdef1234567890")

    latest_path = tmp_path / "baseline" / "latest.json"
    history_files = list((tmp_path / "baseline" / "history").glob("*.json"))

    assert promoted["commit"] == "abcdef1234567890"
    assert latest_path.exists()
    assert len(history_files) == 1
    latest = json.loads(latest_path.read_text(encoding="utf-8"))
    assert latest["agent"]["id"] == result["agent"]["id"]
    assert latest["metrics"]["ia_score"] == result["metrics"]["ia_score"]
    assert latest["cases"] == result["cases"]


def test_promote_rejects_failed_generation_results(tmp_path: Path) -> None:
    result = run(Path("configs/image-agent-smoke.yaml").resolve(), "agent", tmp_path / "run")
    result["metrics"]["failed_generations"] = 1
    result_path = tmp_path / "broken-results.json"
    result_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    with pytest.raises(ValueError, match="failed_generations"):
        promote(result_path, tmp_path / "baseline", "abcdef1234567890")


def test_promote_rejects_incomplete_results(tmp_path: Path) -> None:
    result = run(Path("configs/image-agent-smoke.yaml").resolve(), "agent", tmp_path / "run")
    result["metrics"]["completed_cases"] = result["metrics"]["total_cases"] - 1
    result_path = tmp_path / "incomplete-results.json"
    result_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    with pytest.raises(ValueError, match="incomplete benchmark run"):
        promote(result_path, tmp_path / "baseline", "abcdef1234567890")
