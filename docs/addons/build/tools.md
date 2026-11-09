# Tools

<span id="write-an-addon-with-agent-tools"></span>

Give an agent a named operation with declared inputs and a text result. The [Is dirty? example](/addons/build/control-panel) provides a complete local package and a ticket button calling the same tool. This page defines the tool API; [Messages](/addons/build/actions) explains ticket requests.

## The contract

Export a `tools` value from the preset. Its type is `Preset['tools']` from `@bakers-build/conductor/contract`. The [dirty-check tutorial](/addons/build/control-panel#create-two-files) contains a complete declaration and working handler:

| Field | Meaning |
|---|---|
| `contract` | Required literal `1`. |
| `tools` | Map of tool names to their definitions, such as `git_is_dirty`. |
| `tools.<name>.description` | Explains the operation to the agent. |
| `tools.<name>.input` | Optional input schema; the dirty check omits it and accepts no arguments. |
| `handlers(options)` | Async factory returning one implementation per declared tool name. |

Use the [flat input schema](/addons/build/actions#contract-2). With no `input`, the tool accepts no arguments. Unknown keys and invalid values are refused before the handler runs; defaults do not fill in missing required arguments.

`handlers(options)` is an async factory receiving the entry's `with`. Each declared tool needs one handler, and every handler must be declared. Duplicate tool names across addons fail conductor startup. Prefix names to avoid collisions.

Types `AddonTools`, `ToolDefinition`, `ToolHandler`, `ToolRequest`, `ToolBinding` and `ToolResult` are exported from `@bakers-build/conductor/contract`.

| Handler request | Meaning |
|---|---|
| `args` | Validated input object; empty when no arguments were supplied. |
| `worktreePath` | Absolute path from the caller's binding. |
| `ticket?` | Optional ticket; an operator call may know only its identifier. |
| `signal`, `logger` | Cancellation signal and conductor logger. |
| `callTool(name, args?)` | Calls another tool with the same ticket/worktree and signal. |

Return `{ text: string }`; throw an error to report failure to the caller. Honour cancellation in any child process or network operation.

**The binding is a security boundary.** Never accept a caller-supplied path, URL or ticket that expands the operation beyond its authorized target. Tool handlers run in the conductor's environment, outside the agent's shell sandbox. Validate arguments and target allowlists even when the agent's MCP client approves the call.

## How runs get the server

The conductor's serve process exposes a loopback MCP server named `bakers`. A run token binds calls to its ticket/worktree. Tokens are passed through the environment, not command arguments, and are revoked when the run finishes.

- **Claude and Codex:** their launch configuration adds the conductor's MCP server. Claude measured runs omit this server and its run variables.
- **Grok, Kimi, OpenCode and Pi:** use `bakers tools` from the running agent's shell.
- **Operator CLI:** addon commands such as `bakers ports up` use the conductor's private endpoint file and bind the selected worktree. An ordinary `bakers tools` invocation without run variables reaches the site's server instead.

See [Tools and integrations](/provision/tools) for user access and [run security](/provision/security/execution) for harness policy. In particular, stripping `BB_CONDUCTOR_TOKEN` from the shell environment prevents the run-bound CLI route; do not treat an operator-credential fallback as equivalent access.

A conductor restart normally preserves the port and active grants. If that port is occupied, the conductor chooses another and warns; already-running agents need a new dispatch to receive the new endpoint. Endpoint and grant files under `<BB_HOME>/conductors/` are private (0600); do not copy their contents into tickets.

## Shipped tools

| Tool | Purpose |
|---|---|
| `ports_up(service?)` | Share a claimed service, or every eligible service when omitted. |
| `ports_down(service?)` | Remove one service's tunnel, or every tunnel for the worktree. |
| `ports_status()` | Return tunnel rows with service, status, local origin and URL. |
| `ports_reap()` | Remove routes for vanished worktrees or services. |
| `provision_up(profile?)` | Run the project's configured provisioning hook/profile, when present. |

[Ports](/addons/ports) owns transport prerequisites and public-exposure limits. [Provisioning hooks](/provision/hooks#provision-on-an-agent-s-request) own profile configuration. A runtime addon can add its own tools.

`provision_up` runs for up to 30 minutes and returns the exit code plus the last 64 KB of output; nonzero exit is an error. The command outlives the caller; another call for the same running worktree/profile joins it.

## Site tools

The conductor also proxies the site's allowed ticket tools through the same server, using its own connection. The run holds no site credential. Calls are restricted to the run ticket's project; a foreign ticket, parent, project or workspace is refused.

Missing project arguments on supported search/list/create calls mean the run's project. Missing workspace on label listing means that project's workspace. If the site cannot be reached, addon tools remain available and the next listing retries the site.

The operator endpoint does not expose these site tools. Use the available tool listing and schema for exact arguments; see [the CLI reference](/configuration/clients/tools).

Source: `bakers-cli/conductor/src/plugins/tools.ts`, `src/core/tool-server.ts` and the agent addons' launch implementations.
