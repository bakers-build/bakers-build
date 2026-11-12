# Run isolation through addons

- **Status:** Accepted 2026-11-11. Proposed 2026-11-10 as a spike result; built as the conductor
  `runtime` slot with the [`runtime-docker`](/addons/runtime-docker) backend.
- **Scope:** where an agent run starts (host, box, container per run, micro-VM), separate from the
  harness permission mode

## Recommendation

Build run isolation as a new conductor slot, `runtime`, with a container per run as the first
backend, `runtime-docker`. The default, `runtime-host`, starts runs on the host as before. (The spike
called the slot `isolation` and its backend `isolation-docker`; the tables below keep the spike's
measurements.) The conductor applies the isolation backend to the launch command
after the agent addon has built it and before the executor starts it. Any executor (herdr, orca) then
runs isolated runs without change, and the operator chooses isolation as its own setting, apart
from the harness permission mode. A micro-VM is a later backend behind the same interface. Docker
with the Kata runtime already gives one through `--runtime`.

The spike's throwaway prototype (on its unmerged branch, not in this repository) showed the launch rewrite as an executor decorator. Its self-check passes. A maintainer probe started a
container from that rewrite on Linux. The worktree's Git, the host's loopback and the per-run home
worked, and no SSH key, `~/.bakers` or Docker socket was visible. Through the real herdr executor,
the isolated run passed herdr's launch watch and called a conductor-style MCP tool with its bearer
token. A full conductor run with Claude on a ticket state is still outstanding; its steps are
recorded below. A second probe tested Docker Sandboxes (`sbx`) on the same host. It isolates well
and reaches the conductor tools through its own MCP gateway, without the run token inside the
sandbox. But it starts in about 6 s, cannot reach the host's loopback directly, and needs a Docker
account and a running daemon. It is a later backend, not the first one.

## 1. Where the wrapper hooks in

The executor receives the full launch: `command`, `env` and `workspacePath` in `SpawnRunInput`
(`bakers-cli/conductor/src/plugins/executor.ts`). Rewriting that input is all isolation needs.

| Option | How | Verdict |
|---|---|---|
| (a) new slot (built as `runtime`) | Core holds one isolation backend and calls `wrap({ command, env, workspacePath, run })` before `executor.startRun`, and `cleanup(run)` after `cleanupRun` | **Recommended.** Composes with every executor and harness. It is its own config setting, and backends follow the `ports` / `ports-frp` pattern. |
| (b1) executor decorator, loads its inner executor | The decorator is the executor and loads `with.inner` itself, because the executor slot is a singleton where the last addon wins (`core/src/plugins/discover-addons.ts`) | **Prototype.** It needs no core change, so it suits a spike. The config nests one executor in another, and the inner one is resolved from the decorator's own location. |
| (b2) chained executor decorators | Core passes the previous executor as `deps.inner`, so decorators stack | Possible, but it makes ordering a config concern, and isolation is not an executor. |
| (c) agent addon's launch command | Each harness addon wraps its own command | Rejected. Six harness addons would carry the same wrapper, and an operator could not choose isolation once for all harnesses. |

The prototype's decorator rewrites only `startRun`. All other methods delegate, and `cleanupRun` also
removes the run's container, because closing a herdr pane kills the Docker client but not always the
container.

## 2. A ticket state inside a container per run

Design, as the prototype implements it:

- `docker run --rm -it --name bb-run-<run id> --network host --user <uid>:<gid> … <image> sh -c '<agent command>'`
  inside the herdr pane. herdr writes `KEY=value docker run …` into its 0600 launch file, so secrets
  stay out of argv: the decorator passes them as `-e KEY` and Docker takes the values from its own
  environment.
- The conductor tool server listens on `127.0.0.1` (`conductor/src/core/tool-server.ts`). With
  `--network host`, the `bakers` MCP server in Claude's `--mcp-config` keeps its URL. `bakers_*`,
  `ddev_*`, `provision_up` and `ports_*` run in the conductor on the host, so DDEV is reached only
  through those tools and never through a Docker socket in the run.
- Agent permissions remain unchanged inside the runtime. The runtime wraps the finished agent
  command and reuses the executor; it never downgrades `sandbox` to `system`. Native sandbox
  prerequisites, including nested namespace support on Linux, must exist inside that boundary.
  If unavailable, sandbox mode fails closed; no extra container privileges are granted automatically.

Agents declare neutral installation and model-API facts, and prepare environment/files through
`prepareRun` in the home allocated by the runtime. The conductor forwards these facts and explicit
read/write paths. Docker owns image builds, mounts and proxy transport; Bubblewrap uses the same
preparation without an image. Claude depends on neither runtime addon. Run homes retain their
host paths inside both backends, so agent preparation needs no path translation.

Prototype status, from the recorded run below: the launch rewrite is verified
by its self-check, a container probe, and a run through the real herdr executor
(`herdr-probe.mjs`). The Claude run on a ticket state waits for the maintainer steps below.

- **herdr:** the decorated `docker run -it` ran in herdr's PTY. `startRun` returned after herdr's
  launch watch passed (4.35 s), and `cleanupRun` closed the tab. `-it` would have refused to start
  without a terminal.
- **orca:** not run. It starts runs through the same `writeLaunchScript` launch file and a terminal
  created with `sh '<launch file>'`, so the decorator's rewritten command reaches it the same way.

Known risks to watch in the Claude run:

- The agent command names the CLI's wrapper scripts by their host path (`node <cli>/…/trust-wrapper`),
  so the CLI build is mounted read-only at that same path.
- `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1` installs project plugins into the fresh run home on every run.
  That costs time and needs network.

## 3. Sign-in and model credentials

- **Model credential:** `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or
  `ANTHROPIC_API_KEY` is set in the conductor's environment, and the decorator forwards it by name.
  Nothing from the operator's home is mounted, so `~/.claude`, `~/.ssh`, `~/.bakers`,
  `~/.config/dropsh` and the Docker socket are absent.
- **Run token:** `BB_CONDUCTOR_TOKEN`, issued per run and bound to its worktree. It enters the run
  the same way.
- **Home:** a fresh per-run home on the host (`~/.cache/bakers-isolation/<run uuid>`) is mounted at
  `/home/run`. Only `~/.claude/projects/<worktree key>` is mounted into it at Claude's path, so the
  conductor still reads the run's transcript after finalising.
- **Git push:** fails inside the run, because there is no SSH key. Push from the host instead, after
  the run in the conductor or as a conductor tool. Push is part of delivery, so this is a follow-up.
- **Residual exposure:** the model credential is readable inside the run, and a compromised run can
  use it until it is revoked. A proxy that adds the credential on egress keeps it out of the run.
  That is part of the egress follow-up.
- **`sbx` variant:** its MCP gateway adds the `Authorization` header from the host secret store
  (`sbx secret set mcp:<server>:token`), so the run token never enters the sandbox (measured).
  Header secrets are global per host, not per sandbox. Per-run tokens therefore need one gateway
  server name per run, registered at start and removed at cleanup.

## 4. Cost

| Item | Finding |
|---|---|
| Start time per run | Measured on Debian 13 x86_64 (`probe.sh`): `docker run --rm <image> true` took 1181 ms cold and 396 ms warm. Plugin sync into a fresh home is the larger expected cost and is not measured yet. |
| Image maintenance | One image per harness version. Claude Code is pinned at build, so its own auto-update stops inside the run and an image rebuild replaces it. Podman takes the same image. |
| Worktree and Git metadata | The worktree and the main repository's Git common directory are mounted read/write at their host paths, so `.git` files and `git worktree` links resolve. **Risk:** the run can write `.git/hooks` and `.git/config`, which the host's Git executes later. The backend must mount `hooks` read-only and pin `core.hooksPath`, or give the run its own clone. |
| Transcript | One extra mount per run at Claude's transcript path, under the same uid, so the host can read it. |
| Egress | `--network host` leaves egress open. An allowlist needs a bridge network, the tool server bound to an address that network reaches, and a proxy sidecar. Planned, not built. |
| macOS | Docker Desktop or Podman runs containers in a VM. `--network host` is missing or limited there, so the tool server must listen where the VM reaches it (`host.docker.internal`). Bind mounts cross the VM file share and slow Git and `pnpm`. It works, but it needs the egress design first. |

## 5. Alternatives

| Boundary | Start time | Maintenance | Mounts | Credentials | Egress | Platforms | Verdict |
|---|---|---|---|---|---|---|---|
| Dedicated Unix user | none | user per host, file permissions on shared paths | none, shared file system | separate home | host-wide firewall only | Linux, macOS | Rejected: one user for every run, so runs see each other and anything world-readable. |
| Box as boundary (one VM per operator) | none per run | the box template | none | in the box | box firewall | any | Keep as the outer boundary. Runs on one box still share everything inside it. |
| **Container per run** | 1.2 s cold, 0.4 s warm (measured), plus plugin sync | one image per harness | worktree, `.git`, transcript | per run, by name | allowlist with bridge network and proxy | Linux native, macOS through a VM | **Recommended first backend.** |
| Docker Sandboxes (`sbx` 0.51), a microVM per sandbox with its own Docker engine | 6.1–6.4 s create with the image cached, 45 s with the first pull (measured) | Docker's agent kits; a daemon (`sbx daemon start`), a Docker account login and a global policy preset per host | extra workspaces at their host paths (`PATH[:TARGET][:ro]`), so the Git common directory works (measured) | Claude login stays on the host. Its MCP gateway adds the bearer header from the host secret store, so the run token stays out of the run (measured); header secrets are global per host | preset policies (`balanced`: deny by default, 195 allow rules) and per-sandbox rules; the run's own Docker engine is isolated (0 of the host's 11 containers visible) | needs KVM. Packaged for Ubuntu 24.04+ and Rocky only; on Debian 13 the Ubuntu `.deb` works but gets no updates | **Later backend.** The host's `127.0.0.1` is not reachable: `host.docker.internal` answered 403 from its proxy even with a per-sandbox allow rule. The conductor tools work through `sbx mcp add --url http://127.0.0.1:<port>/ --skip-ssrf-check --skip-auth` and `--static-mcp` (measured). The agent's `--mcp-config` would then point at `$MCP_GATEWAY_URL` instead of the tool server. |
| Micro-VM per run (Firecracker, Kata) | about a second | kernel and rootfs images, KVM on the host | virtio-fs shares | per run | per-VM network | Linux with KVM only | Later backend. Kata as a Docker runtime reuses `runtime-docker`. |
| Hosted sandbox per run | seconds, remote | provider image | the worktree is synced or cloned remotely, no local DDEV | sent to the provider | provider policy | any, needs network | Rejected for now. DDEV and the tool server are local, so every tool call crosses the network. |

The container per run wins because it is the only option that separates runs from each other and
from the operator's home while keeping the worktree, Git and the local conductor tools at their
paths. It also runs on Linux today and gives the micro-VM a backend slot without new interfaces.

## Recorded prototype run

The spike's own steps and results, as run on its branch. The `experimental/` paths named here
exist only there; the built backend's checks are in the ticket's test plan.

### Steps for a maintainer (Linux, Docker)

1. `docker build -t bakers-run-isolation:spike experimental/run-isolation`
2. Start time: `time docker run --rm bakers-run-isolation:spike true` twice (cold after the build, warm).
3. Playground: `bash .bakers/scripts/conductor-e2e.sh`, then `bash .bakers/scripts/conductor-e2e.sh stop`.
4. `cp experimental/run-isolation/isolation-docker.mjs workspaces/bakers-playground/.bakers/`
5. In `workspaces/bakers-playground/.bakers/conductor.config.js` set
   `executor: { plugin: './isolation-docker.mjs', with: { inner: '@bakers-build/addon-herdr', mounts: ['<absolute worktree>/bakers-cli'] } }`.
   The relative `plugin` path resolves from the config directory (ESLint-style resolution).
6. Run Claude in `system` mode for this conductor (the claude addon's security setting).
7. `export CLAUDE_CODE_OAUTH_TOKEN=<token from claude setup-token>`, then `bash .bakers/scripts/conductor-e2e.sh start`.
8. Create a playground ticket in `plan`:
   `ddev drush php:script scripts/e2e/playground-ticket.php -- <conductor id> 'Isolation probe' plan`.
   Its description asks the agent to report, as a comment, the output of: the `bakers_ticket_read`
   tool on its own ticket; `ls -la ~ ~/.ssh ~/.bakers /home/*/.ssh`;
   `test -S /var/run/docker.sock && echo socket || echo no-socket`; `git status`;
   `git push --dry-run origin HEAD`.
9. While the run is active: `docker ps --filter name=bb-run-` on the host.
10. After finalising: `ls ~/.claude/projects/<worktree key>/<run uuid>.jsonl`, and the conductor log
    `workspaces/bakers-playground/.bakers/log.txt` shows the transcript captured.

Expected: the container is listed; `bakers_ticket_read` returns the ticket; `~/.ssh`, `~/.bakers`
and the socket are absent; `git status` works; the push fails for lack of credentials; the transcript
is found.

### Results

| Check | Status | Observed |
|---|---|---|
| Launch rewrite self-check, `node --test experimental/run-isolation/isolation-docker.test.mjs` | passed | 4 tests pass: the argv a shell makes of the command is `docker run --rm -it --name bb-run-7 --network host …`; mounts are only the worktree, the Git common directory, the read-only CLI build, the run home and the transcript directory; secrets appear only as `-e KEY`; other methods delegate and `cleanupRun` removes `bb-run-<id>`. |
| Container probe, `bash experimental/run-isolation/probe.sh` (maintainer, Debian 13 x86_64, Docker; `-it` dropped for lack of a TTY) | passed | The container started from the decorator's own `wrapRun` output. Inside it: `user: 1000 home: /home/run`; `git status` returned `## feat/bakers-155-spike-attach-r`, so the Git common directory resolves; `/home/run/.ssh`, `/home/run/.bakers`, `/home/*/.ssh` and `/root/.ssh` absent; `docker socket: absent`; a stand-in service on the host's `127.0.0.1` answered 200 (`host.docker.internal` gave `ENOTFOUND`, so `--network host` is what carries it); `git push --dry-run` failed; `claude: 2.1.321 (Claude Code)`. |
| `sbx` probe, `sg kvm -c 'bash experimental/run-isolation/probe.sh --sbx-only'` (maintainer, same host, `sbx` 0.51.0 from the Ubuntu 24.04 `.deb`, policy `balanced`) | passed (as a probe) | `sbx create … shell <worktree> <git common dir>` took 44813 ms with the first kit pull and 6380 / 6145 ms after it; `sbx exec` took 465–1081 ms. Inside: `user: 1000 home: /home/agent`; `git status` worked; `.ssh` and `.bakers` absent; a Docker socket is present, but it is the sandbox's own engine (`containers on host: 11, inside: 0`); `127.0.0.1` failed; `host.docker.internal` returned 403, also after `sbx policy allow network --sandbox bb-probe host.docker.internal:<port>`; `git push --dry-run` failed; `BB_CONDUCTOR_TOKEN` set by `-e`. Setup needed `sbx daemon start`, `sbx login` and `sbx policy init balanced`. |
| Conductor tool from inside, Docker (`probe.sh`; stand-in MCP server `mcp-standin.mjs` on the host's `127.0.0.1`, same SDK and Streamable HTTP transport, 401 without the bearer token) | passed | `initialize`, `tools/list` → `bakers_ticket_read`, `tools/call` → `standin-ok`, all 200, with `BB_CONDUCTOR_TOKEN` from the run env. |
| Conductor tool from inside, `sbx` gateway (`probe.sh --sbx-only`; the same stand-in registered with `sbx mcp add … --header 'Authorization: Bearer ${token}'`, secret in the host store, sandbox created with `--static-mcp`) | passed | Inside, `MCP_GATEWAY_URL=http://mcp-gateway.docker.internal/mcp`. Called without a token: `initialize` 200 (`mcp-gateway-bb-probe`), `tools/list` → `bakers_ticket_read code-mode mcp-exec`, `tools/call bakers_ticket_read` → `standin-ok`. The direct route still fails: `127.0.0.1` no answer, `host.docker.internal` 403 "Approval required". |
| Through the real herdr executor, Docker (`node experimental/run-isolation/herdr-probe.mjs docker`) | passed | `startRun` returned after the launch watch, 4.35 s; inside: `home: /home/run`, `git status` worked, `.ssh` and `.bakers` absent, `bakers_ticket_read` → `standin-ok`; `cleanupRun` closed the tab. The report's `tty: NO` came from a probe bug (it tested stdout, which went to the report file). |
| Through the real herdr executor, `sbx` (`herdr-probe.mjs sbx`, launch command `sbx exec -it … bb-herdr sh in-run.sh`) | passed | Launch watch passed; inside: `tty: yes (/dev/pts/0)`, `home: /home/agent`, `git status` worked, `.ssh` and `.bakers` absent; the gateway answered (no server registered in this run, so only its built-in tools). |
| F2 Claude run of a ticket state, `bakers_ticket_read` from inside | not_run | The tool call from inside is proven against a stand-in on the same SDK and transport, in a container started by the real herdr executor. A real conductor run (steps 3–9) is still outstanding: the spike run's sandbox cannot reach the Docker socket and has no model credential. |
| F3 no SSH key, no `~/.bakers`, no socket, push fails | passed | Container probe above. |
| F4 start time and transcript read | passed (start time), not_run (transcript) | 1181 ms cold, 396 ms warm. The transcript read needs the conductor run (step 10). |

## 6. `runtime-sbx` evaluation

Docker Sandboxes (`sbx` 0.51.0, Debian 13 x86_64, measured in the spike above) as a second backend
behind the same `runtime` slot.

| Item | Finding |
|---|---|
| Start time | 6.1–6.4 s to create a sandbox with the image cached, 45 s with the first pull. Docker per run: 1.2 s cold, 0.4 s warm. About 5 s more per run. |
| Requirements | A Docker account login (`sbx login`), a running daemon (`sbx daemon start`), a global policy preset per host, KVM, and Ubuntu 24.04+ or Rocky packaging (on Debian the Ubuntu `.deb` works but gets no updates). |
| Tool server | The host's `127.0.0.1` is not reachable from the sandbox. The route is its MCP gateway: one gateway server name per run, because header secrets are global per host, registered at start and removed at cleanup; the agent's `--mcp-config` points at `$MCP_GATEWAY_URL` instead of the tool server. |
| What it gains | The run token never enters the sandbox: the gateway adds the bearer header from the host secret store. |

**Decision: not adopted now.** About 5 s extra per run start, plus a Docker account and KVM on
every host, outweigh keeping the run token out of the run. The run token is already per run, bound
to its worktree and revoked at finalise, and `runtime-docker`'s allowlist mode keeps the model
credential out of the run. Revisit if Docker drops the account requirement or the start time falls
near Docker's. A shipped `runtime-sbx` backend would be its own ticket.

## Follow-up work

Status after the build:

1. **`runtime` slot** — built: core holds one runtime and applies `wrap` and `cleanup` around
   `executor.startRun` and `cleanupRun`; the configured agent permissions remain unchanged.
2. **`runtime-docker` backend** — built: configurable `docker` command (Podman), a shipped image,
   `.git/hooks` and `.git/config` read-only. Read-only binds cannot stop the run from creating a
   nested repository whose config host Git might execute. This historical cleanup-based
   quarantine is replaced by private metadata and fail-closed gitlink checks below.

3. **Egress allowlist** — built as `runtime-docker`'s `network: 'allowlist'` mode, with one proxy
   sidecar per conductor that adds the model credential. Verified design on Linux; macOS documented,
   not run.
4. **Push from the host** — no code needed: `forge_push` runs in the conductor with the forge
   credential, and the run holds none.
5. **`runtime-sbx`** — evaluated in section 6; not adopted.
6. **Host-executed paths** — `.bakers` is mandatory read-only; addon defaults and project/machine/runtime-entry `runtime.read_only` protect other paths. Host scripts live in `.bakers/scripts`. DDEV contributes `.ddev`; host provisioning writes remain possible. Claude/Codex host sandbox mode applies equivalent write denials. Maintainers deliver protected-file changes outside the run. Package lifecycle scripts, docs configuration and CLI builds remain a separate host-execution gap.

## Git boundary revision

Each isolating run uses independent writable Git metadata, mounted over its worktree admin directory.
The host `.git` pointer is read-only. Both backends mount host Git read-only for refreshing remote-tracking refs; only the private
admin-directory overlay is writable. Shared objects, refs and logs are never writable. Runtime-host Git behavior is unchanged.

`runtime_transfer_commit` accepts a full commit hash and a run-bound grant; the destination comes
from the host-owned launch record. It copies object bytes without following symlinks into clean
scratch metadata, checks object integrity and ancestry, and updates only the intended ticket ref
with its expected old tip. Source config/hooks and unrelated refs are never imported. Every
new commit is checked against protected paths, including edit-then-restore histories, so Git plumbing
cannot bypass read-only host-file protection. The host
index remains separate. Private metadata and host-owned records survive cleanup for recovery;
operators remove them only after delivery. No shared objects or writable hardlinks means no parent
GC dependency. Submodules/gitlinks are refused at startup and transfer: their run-edited metadata
could otherwise execute through concurrent host Git. Built-in host forge tools do not stage files;
custom host hooks that stage or execute arbitrary run-controlled code remain outside this guarantee.
The old per-file shared-metadata protective overlays and post-run quarantine helper are removed: the run
cannot write the host index, and gitlink-bearing starts/transfers are rejected before exposure.

Measurement on this workspace (Linux, revision `582b7ebc85efaefb2561fa17130e1e265b0ca80a`):
two successive `git clone --bare --no-hardlinks` runs took 0.244 / 0.074 seconds and allocated
56,094,720 bytes per copy. `--shared` took 0.010 / 0.009 seconds and allocated 102,400 bytes locally,
excluding the borrowed parent object store. These are first/repeat cache observations, not controlled
cold-cache timings or end-to-end startup measurements. The independent copy retains shared working
files and stable paths, but pays duplicated metadata/object storage per run. The shared alternative
was rejected: safe retention would require protecting objects from parent GC and keeping the
borrowed store strictly read-only. No worktree-equivalent performance is promised.

Docker retains `$XDG_CACHE_HOME/bakers/runtime/<run uuid>.git` and its `.workspace.json` record.
Bubblewrap retains `<cache>/<run uuid>.git` and `.git.json`. Records stay outside run mounts.
Transfer updates the ticket ref, not the host index. After the run stops, a maintainer can reconcile
the index with `git reset --mixed HEAD` in the ticket worktree, preserving working files; first
preserve any host-side staged changes. Retained caches have no automatic GC; remove metadata and
its matching record together only after successful delivery or recovery.
