# Run agents securely

<span id="security"></span>

Choose what an agent can access before it starts working. Its **security context** combines the harness settings, the execution user's rights and the tools available to the run.

## What a sandbox does

A sandbox applies technical limits to operations such as reading or writing files and accessing the network. The **harness**, the program running the agent session, determines which limits it can enforce.

These limits differ. Codex's sandbox does not confine reads; OpenCode and Pi have no OS sandbox. A Git worktree separates source files, and DDEV or Docker can separate application services; neither automatically isolates the agent from the host.

## Choose a security mode

The shared machine and project configuration offers three modes. Select one that the chosen harness supports.

| Mode | Meaning |
|---|---|
| `sandbox` | Use the harness's OS sandbox with configured limits. |
| `system` | Use the harness's existing security configuration; bakers.build adds no security flag. |
| `yolo` | Bypass the harness's sandbox and permission prompts, within the execution user's rights. |

Not every harness supports every mode. OpenCode and Pi ignore the shared mode and run in `system` unless their own entry sets a mode; OpenCode's entry rejects `sandbox`, and Pi's entry supports `system` and its own `custom` configuration, not `sandbox` or `yolo`. Selected harnesses also offer `custom` for advanced configuration. See [modes and harness differences](/provision/security/execution#modes).

<span id="tools-and-isolation-strategy"></span>

## Provision up and addon tools

[Tools](/provision/tools) let an agent request operations through an integration. Their code can run outside the agent sandbox, with different permissions from its shell.

With `provision_up`, the agent selects a configured profile and the project script prepares the application outside the sandbox. This avoids granting its shell general access to the runtime just to start the environment.

The script still runs with the execution user's permissions. Review its configuration and any worktree code it executes: a fixed tool argument does not make an editable script a security boundary. The project script must check readiness and return failures.

Addon tools need the same consideration. `ddev_status()` reports status, while a `provision_exec` key that takes `args` can run any command in a site container. Prefer fixed keys. That container's mounts, credentials and network access, including caches shared with other projects, determine what those commands can reach.

<span id="configure-and-verify"></span>

## Set policy and check it

Use [shared settings](/provision/security/shared-settings) for machine and project policy, and the [agent entry](/agents/reference#run-security) for harness-specific settings. Machine values replace project values key by key; the agent entry can replace both. Unsupported shared keys may be ignored with a warning.

Run `bakers agents` to inspect effective settings and `bakers conductor check` to check supported sandbox prerequisites. Scope [credentials](/provision/security/credentials) to the work. For untrusted workloads, use a dedicated container or VM with limited credentials, or an [isolating runtime](/provision/security/shared-settings#isolated-git-delivery); the harness sandbox is not complete host isolation.

[Execution security](/provision/security/execution) covers exact limits and environment filtering. [Access and data](/provision/security/access-and-data) explains account permissions, stored information and public previews.

**Next:** return to [project verification](/provision/guide#verify-independent-operation). If the project is already connected, check the effective policy before [running a ticket](/get-started/first-ticket).
