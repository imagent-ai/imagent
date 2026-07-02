# Contributing

Thanks for contributing to `imagent`. This repository owns the built-in image
agent implementation.

## What to work on

Start from an open [issue](https://github.com/imagent-ai/imagent/issues). Issues
labeled `good first issue` are the easiest entry points, and `crown` marks the
highest-value work. Comment on an issue to claim it before you start.

Prefer substantive agent code over comments, formatting, or documentation-only
changes.

## Adding or improving an agent

The built-in agent lives under `agent/` with an `agent.yaml` manifest and Python source files:

```python
class MyAgent:
    def setup(self, config: dict, workdir: Path) -> None:
        ...

    def generate(self, case: dict, output_dir: Path) -> dict:
        # returns {"image_path": ..., "trace_path": ..., "metadata": {...}}
        ...
```

`generate` receives a public case payload and must write both an image and a
JSON trace. See `agent/` for the built-in implementation.

If the built-in agent needs extra packages, add `agent/requirements.txt`.

## Pull request rules

- **One concern per pull request**, as a single atomic commit.
- Use a conventional commit prefix: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `perf:`, `chore:`, `ci:`, `build:`, `style:`.
- Keep the diff minimal — unrelated changes risk rejection.
- Fill in the pull request template and make sure CI is green.

## Running locally

```bash
python -m pip install -e ".[dev]"
python -m pytest
```

Live generation requires `OPENROUTER_API_KEY`.

Benchmark configs, task suites, and gating logic are intentionally out of scope
for this repository. They live in `imagent-bench`.

From sibling checkouts:

```bash
python -m pip install -e ../imagent-bench
imagent-bench run \
  --repository . \
  --config ../imagent-bench/configs/official.json \
  --output-dir benchmark-output \
  --fail-on-policy
```

Pull requests run the same deterministic official benchmark in GitHub Actions.
