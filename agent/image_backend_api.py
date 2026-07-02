from __future__ import annotations

import base64
import json
import mimetypes
import os
import urllib.error
import urllib.request
from email.message import Message
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


class ImageBackendError(RuntimeError):
    """Raised when live image generation fails."""


class ImageBackendClient:
    """Generates images through the configured live image backend.

    By default this client targets OpenRouter's ``/api/v1/images`` endpoint with
    the low-cost GPT Image mini model. The backend returns base64-encoded image
    bytes in ``data[].b64_json`` and reports spend in ``usage.cost``, which the
    caller records as ``cost_usd``.
    """

    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self.provider = str(config.get("provider", "openrouter"))
        self.model = str(config.get("model", "openai/gpt-image-1-mini"))
        self.api_key_env = str(config.get("api_key_env", "OPENROUTER_API_KEY"))
        self.api_key = os.environ.get(self.api_key_env)
        if not self.api_key:
            raise ImageBackendError(f"{self.api_key_env} is required for live image generation")
        self.endpoint = str(config.get("endpoint", "https://openrouter.ai/api/v1/images"))
        self.timeout_seconds = int(config.get("timeout_seconds", 300))
        self.size = str(config.get("size", "")) or None
        self.quality = str(config.get("quality", "")) or None
        self.output_format = str(config.get("output_format", "png")) or None
        self.send_seed = bool(config.get("send_seed", False))
        self.send_output_format = bool(config.get("send_output_format", False))
        self.referer = config.get("referer")
        self.title = config.get("title")

    def generate(self, prompt: str, seed: int, output_path: Path) -> dict[str, Any]:
        payload: dict[str, Any] = {"model": self.model, "prompt": prompt}
        if self.size:
            payload["size"] = self.size
        if self.quality:
            payload["quality"] = self.quality
        if self.output_format and self.send_output_format:
            payload["output_format"] = self.output_format
        if seed is not None and self.send_seed:
            payload["seed"] = int(seed)
        extra = self.config.get("parameters", {})
        if isinstance(extra, dict):
            payload.update(extra)

        response = self._post_json(payload)
        image_bytes, media_type = self._extract_image_bytes(response)
        output_path = _resolved_output_path(output_path, media_type, self.output_format)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(image_bytes)

        usage = response.get("usage", {})
        usage = usage if isinstance(usage, dict) else {}
        return {
            "image_path": str(output_path),
            "provider": self.provider,
            "model": self.model,
            "endpoint": self.endpoint,
            "usage": usage,
            "cost_usd": float(usage.get("cost") or 0.0),
            "media_type": media_type,
        }

    def _post_json(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if self.referer:
            headers["HTTP-Referer"] = str(self.referer)
        if self.title:
            headers["X-OpenRouter-Title"] = str(self.title)
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise ImageBackendError(f"image backend HTTP {exc.code}: {body}") from exc
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ImageBackendError("image backend response must be a JSON object")
        if data.get("error"):
            raise ImageBackendError(f"image backend API error: {data['error']}")
        return data

    def _extract_image(self, response: dict[str, Any]) -> tuple[str, str | None]:
        data = response.get("data")
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and item.get("b64_json"):
                    return str(item["b64_json"]), item.get("media_type")
        raise ImageBackendError("image backend response did not include b64_json data")

    def _extract_image_bytes(self, response: dict[str, Any]) -> tuple[bytes, str | None]:
        data = response.get("data")
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and item.get("b64_json"):
                    return base64.b64decode(str(item["b64_json"])), item.get("media_type")
                if isinstance(item, dict) and item.get("url"):
                    return self._download_image(str(item["url"]))
        raise ImageBackendError("image backend response did not include b64_json data or url")

    def _download_image(self, url: str) -> tuple[bytes, str | None]:
        request = urllib.request.Request(url, headers={"User-Agent": "imagent/0.1"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = response.read()
                media_type = _response_media_type(response.headers) or mimetypes.guess_type(
                    urlparse(url).path,
                    strict=False,
                )[0]
                return payload, media_type
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise ImageBackendError(f"image download HTTP {exc.code}: {body}") from exc
        except urllib.error.URLError as exc:
            raise ImageBackendError(f"image download failed: {exc}") from exc


def _resolved_output_path(output_path: Path, media_type: str | None, configured_format: str | None) -> Path:
    extension = _output_extension(output_path, media_type, configured_format)
    if output_path.suffix == extension:
        return output_path
    return output_path.with_suffix(extension)


def _output_extension(output_path: Path, media_type: str | None, configured_format: str | None) -> str:
    if media_type:
        preferred = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/gif": ".gif",
            "image/svg+xml": ".svg",
        }.get(media_type)
        if preferred:
            return preferred
        guessed = mimetypes.guess_extension(media_type, strict=False)
        if guessed:
            return guessed
    if configured_format:
        configured = str(configured_format).strip().lower().lstrip(".")
        preferred = {
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/gif": ".gif",
            "image/svg+xml": ".svg",
        }.get(configured)
        if preferred:
            return preferred
        if "/" in configured:
            guessed = mimetypes.guess_extension(configured, strict=False)
            if guessed:
                return guessed
        return "." + configured
    if output_path.suffix:
        return output_path.suffix
    return ".bin"


def _response_media_type(headers: Message) -> str | None:
    content_type = headers.get("Content-Type")
    if not content_type:
        return None
    return content_type.split(";", 1)[0].strip() or None
