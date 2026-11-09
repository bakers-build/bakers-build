# Run isolation through addons

- **Status:** Proposed 2026-11-10, spike result
- **Scope:** where an agent run starts (host, box, container per run, micro-VM), separate from the
  harness permission mode

## Recommendation

Build run isolation as a new conductor addon kind, `isolation`, with a container per run as the
first backend, `isolation-docker`. The conductor applies the isolation backend to the launch command
after the agent addon has built it and before the executor starts it. Any executor (herdr, orca) then
runs isolated runs without change, and the operator chooses isolation as its own setting, apart
from the harness permission mode. A micro-VM is a later backend behind the same interface. Docker
with the Kata runtime already gives one through `--runtime`.

The throwaway prototype in [`experimental/run-isolation/`](../../experimental/run-isolation/README.md)
shows the launch rewrite as an executor decorator. Its self-check passes. The live run with Claude in
a container is recorded below as steps for a maintainer. The spike run that wrote this page could not
reach the Docker socket from its sandbox and has no model credential of its own.

## 1. Where the wrapper hooks in

The executor receives the full launch: `command`, `env` and `workspacePath` in `SpawnRunInput`
(`bakers-cli/conductor/src/plugins/executor.ts`). Rewriting that input is all isolation needs.

| Option | How | Verdict |
|---|---|---|
| (a) new addon kind `isolation` | Core holds one isolation backend and calls `wrap({ command, env, workspacePath, run })` before `executor.startRun`, and `cleanup(run)` after `cleanupRun` | **Recommended.** Composes with every executor and harness. It is its own config setting, and backends follow the `ports` / `ports-frp` pattern. |
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
- The harness sandbox is off inside the container (Claude in `system` mode). The container takes
  its place. bubblewrap inside an unprivileged container needs extra privileges, and the two do
  not stack.

Prototype status, from [the recorded run](#recorded-prototype-run): the launch rewrite is verified
by its self-check. The container run itself is **blocked** for the spike run and waits for the
maintainer steps below.

Known risks to watch in that run:

- herdr's launch watch reads the pane. `docker run -it` in herdr's PTY has not been tried.
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

## 4. Cost

| Item | Finding |
|---|---|
| Start time per run | Not measured by the spike run (blocked). Steps 2 and 9 below record cold and warm `docker run` times. Plugin sync into a fresh home is the larger expected cost. |
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
| **Container per run** | sub-second plus plugin sync (to measure) | one image per harness | worktree, `.git`, transcript | per run, by name | allowlist with bridge network and proxy | Linux native, macOS through a VM | **Recommended first backend.** |
| Micro-VM per run (Firecracker, Kata) | about a second | kernel and rootfs images, KVM on the host | virtio-fs shares | per run | per-VM network | Linux with KVM only | Later backend. Kata as a Docker runtime reuses `isolation-docker`. |
| Hosted sandbox per run | seconds, remote | provider image | the worktree is synced or cloned remotely, no local DDEV | sent to the provider | provider policy | any, needs network | Rejected for now. DDEV and the tool server are local, so every tool call crosses the network. |

The container per run wins because it is the only option that separates runs from each other and
from the operator's home while keeping the worktree, Git and the local conductor tools at their
paths. It also runs on Linux today and gives the micro-VM a backend slot without new interfaces.

## Recorded prototype run

### Steps for a maintainer (Linux, Docker)

1. `docker build -t bakers-run-isolation:spike experimental/run-isolation`
2. Start time: `time docker run --rm bakers-run-isolation:spike true` twice (cold after the build, warm).
3. Playground: `bash scripts/conductor-e2e.sh`, then `bash scripts/conductor-e2e.sh stop`.
4. `cp experimental/run-isolation/isolation-docker.mjs workspaces/bakers-playground/.bakers/`
5. In `workspaces/bakers-playground/.bakers/conductor.config.js` set
   `executor: { plugin: './isolation-docker.mjs', with: { inner: '@bakers-build/addon-herdr', mounts: ['<absolute worktree>/bakers-cli'] } }`.
   The relative `plugin` path resolves from the config directory (ESLint-style resolution).
6. Run Claude in `system` mode for this conductor (the claude addon's security setting).
7. `export CLAUDE_CODE_OAUTH_TOKEN=<token from claude setup-token>`, then `bash scripts/conductor-e2e.sh start`.
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
| Launch rewrite self-check, `node --test experimental/run-isolation/` | passed | 4 tests pass: the argv a shell makes of the command is `docker run --rm -it --name bb-run-7 --network host …`; mounts are only the worktree, the Git common directory, the read-only CLI build, the run home and the transcript directory; secrets appear only as `-e KEY`; other methods delegate and `cleanupRun` removes `bb-run-<id>`. |
| F2 container listed, conductor tool reachable from inside | blocked | The spike run's sandbox is denied `/var/run/docker.sock` (`permission denied while trying to connect to the docker API`) and has no model credential. Steps 1–9 are for the maintainer. |
| F3 no SSH key, no `~/.bakers`, no socket, push fails | blocked | Same cause; step 8. |
| F4 start time and transcript read | blocked | Same cause; steps 2 and 10. |

## Follow-up work

Tickets to create once this recommendation is approved:

1. **`isolation` addon kind.** Core holds one backend and applies `wrap` and `cleanup` around
   `executor.startRun` and `cleanupRun`. It adds an operator setting separate from the harness
   permission mode, and the harness sandbox is off when a backend is set.
2. **`isolation-docker` backend.** It ports the prototype, makes the `docker` command configurable
   so Podman works, ships the image, and protects `.git/hooks` and `.git/config`. It also measures
   start time and plugin sync.
3. **Egress allowlist.** A bridge network, the tool server reachable from it, and a proxy sidecar
   that also adds the model credential, so the credential leaves the run. macOS depends on this.
4. **Push from the host.** Delivery pushes the branch outside the run, after it or through a
   conductor tool.
