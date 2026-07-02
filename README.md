# imagent

`imagent` is the built-in image agent package. This repository owns the agent
manifest, image-generation client, and agent implementation.

## Quick Start

```bash
python -m pip install -e ".[dev]"
python -m pytest
```

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
