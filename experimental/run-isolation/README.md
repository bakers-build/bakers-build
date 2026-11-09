# Run isolation spike (throwaway)

An executor decorator that starts every agent run in its own Docker container. Not a product
addon: nothing under `bakers-cli/` uses it. The recommendation, the recorded steps and their
results are in [docs/decisions/run-isolation.md](../../docs/decisions/run-isolation.md).

- `isolation-docker.mjs` — the decorator; wraps the inner executor's launch command in `docker run`.
- `Dockerfile` — `node:22-slim`, `git`, Claude Code.
- Self-check: `node --test experimental/run-isolation/`.
