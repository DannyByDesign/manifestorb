# Tests (`tests/`)

This repo uses Vitest for unit, integration, E2E, and eval-style tests.

## Quick Commands

```bash
# Core/unit-ish suite
bun run test-ai

# Integration tests
bun run test:integration

# E2E tests (see tests/e2e/README.md for live harness env)
bun run test:e2e

# Evals (taxonomy, memory recall, search calibration)
bun run test:evals
```

## Layout

- `tests/e2e/`: live/critical E2E harnesses (Slack + Google + main app)
- `tests/evals/`: evaluation corpora and gates
- `tests/support/`: shared setup and helpers

