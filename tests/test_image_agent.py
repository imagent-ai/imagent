from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import pytest

from imagent_bench.runner import run

AGENT_ROOT = Path("agents/image_agent").resolve()
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from image_agent.agent import ImageAgent
from image_agent.image_backend_api import ImageBackendClient


def test_image_agent_mock_runs_smoke_suite(tmp_path: Path) -> None:
    result = run(Path("configs/image-agent-smoke.yaml").resolve(), "agents/image_agent", tmp_path)

    assert result["agent"]["id"] == "image-agent"
    assert result["metrics"]["failed_generations"] == 0
    assert result["metrics"]["total_cases"] == 6
    assert result["metrics"]["pass_rate"] == 1.0
    assert result["metrics"]["checklist_accuracy"] == 1.0
    assert result["cases"][0]["output"]["metadata"]["provider"] == "mock"


def test_image_agent_live_requires_api_key(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    config_path = tmp_path / "live.yaml"
    config_path.write_text(
        """
suite:
  id: ia_bench_v1
  tasks: [plan]
  max_cases: 1
runtime:
  seeds: [1001]
  deterministic: false
  timeout_seconds_per_case: 60
agent:
  image_backend:
    mode: live
metrics:
  primary: ia_score
""",
        encoding="utf-8",
    )

    with pytest.raises(Exception, match="OPENROUTER_API_KEY"):
        run(config_path.resolve(), "agents/image_agent", tmp_path / "out")


def test_image_backend_client_uses_returned_media_type_extension(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client = ImageBackendClient({"output_format": "png"})
    jpeg_bytes = b"jpeg-bytes"

    def fake_post(payload: dict) -> dict:
        return {
            "data": [
                {
                    "b64_json": base64.b64encode(jpeg_bytes).decode("ascii"),
                    "media_type": "image/jpeg",
                }
            ],
            "usage": {"cost": 0.01},
        }

    monkeypatch.setattr(client, "_post_json", fake_post)

    metadata = client.generate("prompt", 1001, tmp_path / "image.png")

    assert metadata["media_type"] == "image/jpeg"
    assert metadata["image_path"].endswith(".jpg")
    assert (tmp_path / "image.jpg").read_bytes() == jpeg_bytes


def test_image_agent_records_actual_live_image_format(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    agent = ImageAgent()
    agent.setup({"runtime": {}, "agent": {"image_backend": {"mode": "live"}}}, tmp_path)

    class FakeClient:
        def generate(self, prompt: str, seed: int, output_path: Path) -> dict[str, object]:
            jpg_path = output_path.with_suffix(".jpg")
            jpg_path.write_bytes(b"jpg")
            return {
                "image_path": str(jpg_path),
                "provider": "openrouter",
                "model": "fake-model",
                "cost_usd": 0.01,
            }

    agent.client = FakeClient()
    output = agent.generate(
        {
            "run_id": "live-case",
            "capability": "plan",
            "prompt": "Create a card.",
            "seed": 1001,
            "allowed_tools": [],
        },
        tmp_path,
    )

    trace = json.loads(Path(output["trace_path"]).read_text(encoding="utf-8"))

    assert output["image_path"].endswith(".jpg")
    assert trace["planning"]["generation_plan"]["format"] == "jpg"
