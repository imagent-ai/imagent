from __future__ import annotations

from pathlib import Path

from imagent_bench.config import validate_result_schema
from imagent_bench.runner import run


def test_runner_writes_valid_results(tmp_path: Path) -> None:
    result = run(
        Path("configs/local-smoke.yaml").resolve(),
        "tests/fixtures/echo_agent",
        tmp_path,
    )

    assert validate_result_schema(result) == []
    assert result["metrics"]["failed_generations"] == 0
    assert result["metrics"]["total_cases"] == 6
    assert result["metrics"]["pass_rate"] == 1.0
    assert "cost_usd" in result["metrics"]
    assert result["metrics"]["judge_cost_usd"] == 0.0
    assert (tmp_path / "results.json").exists()
    assert (tmp_path / "summary.md").exists()


def test_runner_raises_for_missing_public_input_file(tmp_path: Path) -> None:
    suite_dir = tmp_path / "suite"
    suite_dir.mkdir()
    (suite_dir / "suite.yaml").write_text(
        """
id: broken_suite
version: 1
tasks:
  broken: cases/broken.jsonl
""",
        encoding="utf-8",
    )
    cases_dir = suite_dir / "cases"
    cases_dir.mkdir()
    (cases_dir / "broken.jsonl").write_text(
        """
{"id":"broken-asset-001","capability":"plan","prompt":"Create a card.","assets":["missing.txt"],"allowed_tools":[],"expected":{"checks":[{"type":"always"}]}}
""".strip()
        + "\n",
        encoding="utf-8",
    )

    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        """
suite:
  path: suite/suite.yaml
runtime:
  seeds: [1001]
metrics:
  primary: ia_score
""",
        encoding="utf-8",
    )

    try:
        run(config_path, "tests/fixtures/echo_agent", tmp_path / "out")
    except FileNotFoundError as exc:
        assert "missing.txt" in str(exc)
    else:
        raise AssertionError("expected FileNotFoundError for missing public input file")
