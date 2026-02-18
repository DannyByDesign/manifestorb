# Scripts (`scripts/`)

Root-level utilities used for local development and CI-style checks.

These are invoked via `package.json` scripts (run with `bun run ...`).

## Files

- `dev-stack.ts`: runs main app + sidecar together and prints periodic health checks (`/api/health`, `/health`).
- `encryption_sanity.ts`: verifies encryption primitives/config are working (useful when changing secrets or crypto helpers).
- `prisma-migrate-deploy.sh`: deploy-time migration helper.
- `lint-changed.sh`: lint only changed files (git-based).
- `lint-baseline.sh`: lint with a baseline file under `artifacts/`.
- `skills-scenario-harness.ts`: harness for running scenario-style skill/runtime tests.
- `taxonomy-eval.ts`: taxonomy evaluation harness (writes reports when configured).

If you add a new script that other developers should use, add it to `package.json` and document it here.

