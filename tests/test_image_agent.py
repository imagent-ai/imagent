from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from agent import ImageAgent
from agent.image_backend_api import ImageBackendClient


def _mock_config(*, mode: str = "mock") -> dict:
    return {
        "runtime": {"max_feedback_rounds": 1},
        "agent": {"image_backend": {"mode": mode}},
    }


def test_image_agent_mock_generate_writes_svg_and_trace(tmp_path: Path) -> None:
    agent = ImageAgent()
    agent.setup(_mock_config(), tmp_path)

    output = agent.generate(
        {
            "run_id": "plan-layout-001--seed-1001",
            "capability": "plan",
            "prompt": "Create a three-panel infographic titled Context Gap Toolkit with sections Plan, Ground, Verify.",
            "seed": 1001,
            "allowed_tools": ["plan"],
        },
        tmp_path,
    )

    image_path = Path(output["image_path"])
    trace_path = Path(output["trace_path"])
    trace = json.loads(trace_path.read_text(encoding="utf-8"))

    assert image_path.exists()
    assert trace_path.exists()
    assert output["metadata"]["provider"] == "mock"
    assert trace["planning"]["generation_plan"]["format"] == "svg"
    assert "Context Gap Toolkit" in image_path.read_text(encoding="utf-8")


def test_image_agent_live_requires_api_key(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    agent = ImageAgent()

    with pytest.raises(Exception, match="OPENROUTER_API_KEY"):
        agent.setup(_mock_config(mode="live"), tmp_path)


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
    agent.setup(_mock_config(mode="live"), tmp_path)

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
