# imagent

`imagent` is the built-in image agent package. This repository owns the agent
manifest, image-generation client, and agent implementation.

## Quick Start

```bash
python -m pip install -e ".[dev]"
python -m pytest
```

## Local Benchmark

The official benchmark runner lives in
[`imagent-bench`](https://github.com/imagent-ai/imagent-bench). From sibling
checkouts:

```bash
python -m pip install -e ../imagent-bench
imagent-bench run \
  --repository . \
  --config ../imagent-bench/configs/official.json \
  --output-dir benchmark-output \
  --fail-on-policy
```

The default official benchmark uses the deterministic mock image backend, so it
is safe to run on pull requests without provider secrets.

For a real Z.AI image-generation smoke test:

```bash
export ZAI_API_KEY=<your-zai-api-key>
imagent-bench run \
  --repository . \
  --config ../imagent-bench/configs/zai-live-smoke.json \
  --output-dir benchmark-output-zai \
  --fail-on-policy
```

For a real OpenRouter image-generation smoke test:

```bash
export OPENROUTER_API_KEY=<your-openrouter-api-key>
imagent-bench run \
  --repository . \
  --config ../imagent-bench/configs/openrouter-live-smoke.json \
  --output-dir benchmark-output-openrouter \
  --fail-on-policy
```

The OpenRouter live-smoke benchmark uses `openai/gpt-image-1-mini` with
`quality: low` to keep real-provider test cost low.

## Local Demo

```python
from pathlib import Path

from agent import ImageAgent

agent = ImageAgent()
agent.setup(
    {
        "runtime": {"max_feedback_rounds": 1},
        "agent": {"image_backend": {"mode": "mock"}},
    },
    Path("."),
)

result = agent.generate(
    {
        "run_id": "demo-card",
        "capability": "plan",
        "prompt": "Create a three-panel infographic titled Context Gap Toolkit with sections Plan, Ground, Verify.",
        "seed": 1001,
        "allowed_tools": ["plan"],
    },
    Path("results/demo"),
)

print(result)
```

The mock path renders deterministic SVG output. Live generation uses OpenRouter
and requires `OPENROUTER_API_KEY`.

## Repository Boundary

This repository stays focused on the built-in agent. Benchmark configs, tasks,
comparisons, and promotion flows live in
[`imagent-bench`](https://github.com/imagent-ai/imagent-bench).
