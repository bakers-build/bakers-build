## Initial context troubleshooting

If the read returns HTTP 404, say this plainly before trying another command:

> The ticket read 404'd — the UUID isn't resolving on the control plane this cwd reaches. Let me
> check config resolution and read WORKFLOW.md.

Then inspect the effective checkout and connection context before retrying:

```bash
git rev-parse --show-toplevel
git worktree list --porcelain
find . .. -path '*/.bakers/bakers.config.js' -type f -print 2>/dev/null
bakers dropsh auth status
```

Read the nearest `WORKFLOW.md`, confirm that the UUID belongs to this control plane, and retry the
exact command above. A 404 after that retry is a control-plane/UUID mismatch, not permission to
substitute another ticket or to write anything.

## When the renderer is missing

The read fails with:

```
E_CONFIG: Unknown format 'md'. Available: json
```

The selected connection lacks the Markdown renderer. Inspect its source path and run
`bakers config check --scope connection` for the global connection or
`bakers config check --scope project --path <root>` for a project override. Preserve explicit
connection/path choices. Follow the shared diagnostics through `@bakers-build/bb-upgrade-project`:
`bakers config upgrade` migrates supported global and existing project connection shapes and reports
unsupported custom rewrites. A read-only ticket request authorizes diagnosis; apply a configuration
repair only within the caller's existing authorization. Report the selected file and remedy.

Falling back to a raw JSON:API read is permitted **only while saying so out loud in the run** — name
the renderer error, name the fix, and say that the context that follows is raw JSON:API. A silent
fallback is forbidden: it hands the rest of the step unreadable JSON while hiding a one-command fix,
so whatever goes wrong later reads as a context problem rather than the configuration problem it is.
