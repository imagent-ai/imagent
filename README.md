# imagent

`imagent` provides an open benchmark foundation for image agents. The initial
benchmark runner focuses on deterministic, inspectable evaluations so future
agent implementations and CI gates can build on a stable contract.

## Quick Start

```bash
python -m pip install -e ".[dev]"
python -m imagent_bench.config validate configs/local-smoke.yaml
python -m imagent_bench.runner \
  --config configs/local-smoke.yaml \
  --agent tests/fixtures/echo_agent \
  --output results/local-smoke
```

The smoke suite writes normalized JSON results, per-case traces, image artifacts,
and a Markdown summary under the selected output directory.

These commands assume a source checkout of this repository. The published Python
wheel includes the `imagent_bench` package and bundled task data, but it does
not install the repository-local `configs/` files or bundled baseline agent
directories.

## Image Agent

The repository includes a general image agent with a deterministic mock mode for
local testing:

```bash
python -m imagent_bench.runner \
  --config configs/image-agent-smoke.yaml \
  --agent agent \
  --output results/image-agent-smoke
```

Live generation is configured through `agent.image_backend.mode: live` and
requires `OPENROUTER_API_KEY`. It calls OpenRouter's image API and records the
gateway-reported spend as `cost_usd`.

Trusted API benchmark runs use the chat-completions image judge configured in
`configs/api-gate.yaml`. This mode also uses the image agent, so
`OPENROUTER_API_KEY` covers both generation and judging.

The offline smoke and PR gate configs use the deterministic `mock_text` image
judge by default. That provider inspects generated file text for stable contract
testing; it is not a real visual-quality or semantic image assessment.

The image judge runs through a chat-completions vision API (default model
`openai/gpt-4o`). This mode reads `OPENROUTER_API_KEY` and reaches many
vision-capable models through a single credential.

## Result Comparison

Benchmark results can be compared with configurable acceptance rules:

```bash
python -m imagent_bench.compare \
  --config configs/pr-gate.yaml \
  --baseline results/base/results.json \
  --candidate results/pr/results.json \
  --output results/comparison.json
```

## Continuous Benchmarking

Pull requests are evaluated by the offline benchmark workflow in
`.github/workflows/benchmark-pr.yml`. The workflow installs benchmark code from
the PR base branch, runs the base image agent and candidate image agent, then
compares the results with `configs/pr-gate.yaml` when the image agent changes.

Clean main-branch benchmark results can be promoted into baseline history with:

```bash
python -m imagent_bench.promote_baseline \
  --result results/api-main/results.json \
  --baseline-dir baselines/image_agent/ia_bench_v1_api
```

See `docs/api_benchmark.md` for the trusted API benchmark workflow setup.
