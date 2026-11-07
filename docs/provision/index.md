# Provision

Prepare the machine and application environment where agents work. Start with [machine setup](/get-started/machine) on either a developer computer or remote worker; tools, credentials and resources belong there.

- [Worker servers](/provision/worker-server) and [Coder workspaces](/provision/coder-workspace) cover remote execution.
- [Choose an environment](/provision/guide), then follow [Docker Compose](/provision/docker-compose) or [Node.js](/provision/node).
- [Lifecycle hooks](/provision/hooks) connect repository setup and cleanup to worktrees and runs.

## From ticket to cleanup

The conductor creates or reuses a worktree, runs `after_create` when preparation is needed, opens a fresh worktree's layout, runs `before_run`, then launches the agent. `after_run` follows the stopped worker. Ticket cleanup runs `after_done` before removing the worktree; freeze and resume have their own hooks.

Successful `after_create` preparation is recorded by worktree path and survives conductor restarts. Reusing that worktree skips preparation. Failure retries on a later dispatch; recreation prepares again. Lifecycle failures are logged and work continues.

A workflow's [provisioning instructions](/skills-and-workflows/workflow-file) tell the agent when to call `provision_up` and which profile to select. That tool runs the configured command outside the agent sandbox and returns failures as errors. Required readiness checks belong in the workflow. See [hook ordering and environment](/provision/hooks) before writing commands or addon listeners.

[Security](/security/) explains the trust boundary. [Self-hosting](/self-hosting/) concerns the application server, not workers.
