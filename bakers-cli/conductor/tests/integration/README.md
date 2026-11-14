# Integration tests

## The herdr suites run against their own herdr server

`herdr-worktree-cleanup.test.ts` and `worktree-lifecycle.test.ts` drive the real
`herdr` binary. They do **not** drive the developer's daemon: each starts a
private `herdr server` with its own socket and its own state directory
(`XDG_CONFIG_HOME` + `HERDR_SOCKET_PATH` pointed into one `mkdtemp`), via
[`../helpers/herdr-test-server.ts`](../helpers/herdr-test-server.ts).

**The invariant:** no call in these suites may reach the developer's daemon.
Both env vars are required — a socket override alone still loads the dev
daemon's workspaces, because herdr persists state in `<config home>/herdr/
session.json`. The helper scrubs *every* inherited `HERDR_*` variable (prefix,
not a deny-list) so nothing can leak back, and refuses to start if its socket
would resolve outside its own temp directory. Teardown is `herdr server stop` →
`SIGTERM` → `SIGKILL` → `rm -rf`, registered both as `afterAll` and as a
`process.on('exit')` hook, so a mid-test failure or a hard interrupt still
leaves no orphaned server and no `/tmp/bakers-herdr-*` residue.

The suite's own `process.env` is redirected too — that is the only way to reach
the `sh -c` lifecycle hooks and the executor's default exec, which merge a
caller env over `process.env` and can never *remove* an inherited key. That
redirect is deliberately narrow: it drops the `HERDR_*` keys and sets
`HERDR_SOCKET_PATH`, and it leaves `XDG_CONFIG_HOME` alone. The socket alone is
what routes a CLI call to the private daemon; the config home only decides where
the *server* persists state, and the server gets it through its own environment.
Redirecting `XDG_CONFIG_HOME` process-wide would hand the temp dir to `ddev`
(`$XDG_CONFIG_HOME/ddev`) and `git` (`$XDG_CONFIG_HOME/git/config`) as well.

Before BB-229 the suites ran against the developer's live daemon and left a
stale `bakers-cleanup-* (deleted)` workspace behind on every run.

## Gates

| Suite | Gates |
|---|---|
| `herdr-worktree-cleanup.test.ts` | a `herdr` binary on PATH |
| `worktree-lifecycle.test.ts` | a `herdr` binary on PATH **and** `BB_E2E_BASE_URL` |
| `conductor.test.ts`, `writeback.test.ts` | `BB_E2E_BASE_URL` |

`conductor.test.ts` also owns the live gzip/omission wire. After
the claim/dispatch tests close over GL-E2E-CONDUCTOR's one freshly-claimable
run, the same file drives `drupalRemote().createRemote()` — with
`basicAuthProvider(BB_E2E_BASIC)` and `site.base_url` pointing at a counting
loopback proxy, not raw DDEV — so gzip is on the production transport. A
measured 40 MiB JSONL must cross a 32 MiB incoming-byte cap; uncompressed
`log_sha256`/`log_bytes` must match; gzip upload and gzip/identity download
wire bodies (captured with Node `http`/`https`, because native fetch
auto-decompresses) must each be ≤50% of identity. A second proxy cap below
the compressed body and above the fallback body yields one size failure, a
successful omission close, the durable warning
`Transcript upload omitted because the run-log upload exceeded a size limit.`,
and no retry on the next tick. `ddev bakers-test-integration` is the command
(recipe-test world; the harness resets the fixture once per vitest run).
Do not add a second file that claims GL-E2E-CONDUCTOR.

Existing-config does not seed this fixture. After recipe checks pass, prove
`bb_core_update_8037` installed the custom-storage field (no payload
column) and `bb_core.run_log_compression_subscriber` is present, then
bootstrap one ordinary non-uid-1 actor plus one run as uid 1 and repeat the
counting-proxy round trip authenticated as that actor. Do not run
`ddev bakers-test-integration` on existing-config.

Neither herdr suite needs `HERDR_ENV` any more; each skips cleanly where its
gates are unmet.

`worktree-lifecycle`'s second gate is independent of herdr and is not going
away: the suite needs a running, seeded bakers site and a real DDEV host. Only the
herdr **daemon** is isolated — the `after_create: bash .bakers/scripts/worktree-post.sh` hook still
runs against the real checkout and the real DDEV project.

**CI:** `ddev bakers-test-integration` runs inside the web container, which has no
`herdr` binary, so both herdr suites still skip there. The gate change makes
them runnable on any herdr-equipped machine; it does **not** by itself add CI
coverage, and installing herdr into the CI image is out of scope. The pure
environment-scrub unit test (`../helpers/herdr-test-server.test.ts`) *does* run
in CI — it is covered by the default vitest config.

## Worktree lifecycle E2E (host-only)

`worktree-lifecycle.test.ts` drives the full real chain (dropsh ticket → run →
herdr worktree → conductor teardown) on the **host**.

```bash
ddev init --provider recipe-test       # seed the bb_e2e world once
source tests/artifacts/bakers/env            # BB_E2E_BASE_URL + BB_E2E_BASIC
# If base_url is container-internal, override to the host-reachable ddev URL:
#   export BB_E2E_BASE_URL="https://<project>.ddev.site"
cd bakers-cli && pnpm test:integration worktree-lifecycle
```

A FAIL at "worktree is gone on disk" reproduces the worktree-cleanup bug; read
the conductor's `worktree teardown failed` warn line for the root cause.

## Verifying the isolation (BB-229 AC-1)

The suites cannot assert this themselves: the developer is normally using the
daemon while they run, so an equality assertion would compare against a moving
target. Verify it by hand instead — in a shell carrying the **ambient** herdr
environment:

```bash
herdr workspace list > /tmp/before.json
cd bakers-cli && pnpm test:integration          # run the herdr suites
herdr workspace list > /tmp/after.json
diff /tmp/before.json /tmp/after.json         # expect: empty
```

Pass = an empty diff. In particular no `bakers-cleanup-*` workspace, no
`bakers/cleanup-regression`, and an unchanged ambient context. Also worth checking
after a run: `pgrep -f 'herdr server'` shows at most your own daemon, and
`ls -d /tmp/bakers-herdr-*` matches nothing.
