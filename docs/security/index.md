# Security

Give each run the tools and access its task needs. Start with [execution boundaries](/security/execution), then configure [shared settings](/security/shared-settings) and the selected [harness](/agents/).

## Tools and isolation strategy

Prepare dependencies and services through reviewed [hooks](/provision/hooks) outside the agent sandbox. Offer configured conductor tools for privileged operations, so the agent selects an operation or profile rather than arbitrary host commands. These tools and hooks still execute with worker permissions: review their code and inputs.

A worktree separates files, not users or credentials. Harness sandboxes enforce different filesystem, network and MCP limits. Codex does not confine reads; OpenCode and Pi have no OS sandbox. Trusted commands can escape a harness sandbox. Use the [harness-specific references](/security/execution#modes) to understand actual guarantees.

Shared machine/project `security` settings exist, but they do not create one universal sandbox. Some keys are ignored or rejected by particular harnesses. Provider credentials, connection files and host isolation need their own controls.

## Configure and verify

1. Scope [credentials](/security/credentials) to the work and keep them off tickets and Git.
2. Inspect effective policy with `bakers agents` and test supported sandbox prerequisites with `bakers oven check`.
3. Check [ticket environment filtering](/security/execution#ticket-env-vars), MCP access, trusted commands and host/container/VM limits before dispatch.

[Access and data](/security/access-and-data) covers workspace permissions, stored information and public previews. [Self-hosting](/self-hosting/) owns server operations and backups.
