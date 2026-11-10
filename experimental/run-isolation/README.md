# Run isolation spike (throwaway)

An executor decorator that starts every agent run in its own Docker container. Not a product
addon: nothing under `bakers-cli/` uses it. The recommendation, the recorded steps and their
results are in [docs/decisions/run-isolation.md](../../docs/decisions/run-isolation.md).

- `isolation-docker.mjs` — the decorator; wraps the inner executor's launch command in `docker run`.
- `Dockerfile` — `node:22-slim`, `git`, Claude Code.
- Self-check: `node --test experimental/run-isolation/isolation-docker.test.mjs`.
- `probe.sh` — runs a container from the decorator's launch rewrite and reports what the run sees,
  including a conductor-style MCP call. `--sbx-only` runs the Docker Sandboxes part alone (through
  its MCP gateway). Run it outside any agent sandbox.
- `herdr-probe.mjs docker|sbx` — starts an isolated run through the real herdr executor; the run
  executes `in-run.sh` and writes its report to `assets-ai/BAKERS-155/`.
- `mcp-standin.mjs` — an MCP server on `127.0.0.1` with a bearer token, standing in for the
  conductor tool server; `mcp-call.sh` is the curl client the probes use.
