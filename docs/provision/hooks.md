# Add lifecycle hooks

Use hooks to prepare a ticket worktree, refresh it before a run or release its resources when work ends. Use an on-demand tool when the agent needs to choose when an application starts.

**You need:** a working conductor, its committed project configuration, and a project setup command that is safe to repeat. Choose that command from your repository's existing scripts.

1. Merge one hook into `.bakers/project.config.js`, keeping the other settings:

   ```js
   hooks: { after_create: 'sh .bakers/scripts/prepare.sh' },
   ```

   Supply `.bakers/scripts/prepare.sh`; the example does not create it. See the [Node.js example](/provision/node-project) for a locked dependency install, or [Compose](/provision/docker-compose) for service setup and scoped cleanup.

2. Run the command twice in a disposable worktree. It should prepare missing resources and preserve resources that are already ready. Keep long-running servers out of blocking setup commands.

3. Run `bakers config check --scope project`, then dispatch a small ticket. Check the actual files/services and `.bakers/log.txt` for hook failures.

**Done when:** the ticket worktree has the required environment and repeat setup is safe. A valid config or a started agent alone does not establish readiness.

Hooks run worktree code with the conductor user's permissions, outside the agent sandbox. Failures are logged and work continues; put required checks in `WORKFLOW.md`. Cleanup must affect only this worktree and preserve needed data.

## When each hook runs

The [six-hook catalog](/configuration/project/hooks#when-each-hook-runs) defines preparation, run, cleanup, freeze and resume timing, including retries and reuse.

## Environment

The [environment reference](/configuration/project/hooks#environment) lists injected variables. The `after_done` shell command receives no injected ticket variables; use a validated worktree-local identity for cleanup.

## Failure behavior

See [failure and retry behavior](/configuration/project/hooks#failure-behavior) before relying on setup or cleanup.

## Provision on an agent's request

Configure [`provision_up`](/configuration/project/hooks#provision-on-an-agent-s-request) when checks need a running environment. It is an explicit tool call, not an automatic lifecycle event. Your script owns reuse, readiness and the returned URL.

## Add a listener from an addon

Addon authors use the existing [hook listener contract](/addons/build/contracts#surfaces-and-extension-points).

## Clean up a preview

`after_done: 'bakers ports down mailpit'` closes a tunnel opened for that service. It does not stop the application. [Ports](/addons/ports) owns service sharing and tunnel cleanup.

## Protect host-executed files

Keep hook and provisioning scripts and their host-side helpers in `.bakers/scripts/`. The
runtime always protects `.bakers/`. DDEV's addon also protects `.ddev/` by default. For a required
host-read or host-executed path that cannot move and is not covered by an addon, extend
`runtime.read_only` with `['$inherit', 'path']`; see [shared runtime settings](/provision/security/shared-settings).
An existing script move needs maintainer consent and updates to every caller.

To change a protected file, have a maintainer apply and deliver the change outside the isolated
run. This also applies when a target-branch merge changes protected files. Protection of a
wrapper does not protect application code it executes: dependency lifecycle scripts, docs build
configuration and CLI sources remain a host-execution gap. Host runs in `yolo` or `system`, and
host agents other than Claude or Codex in `sandbox`, cannot enforce this boundary.
