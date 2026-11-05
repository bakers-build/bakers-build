# Write an addon with agent tools

An addon gives agents tools by exporting `tools` from its preset. This page is the contract; the shipped examples are [Ports](/addons/ports) and [DDEV discovery](/addons/ddev).

## The contract

An addon gives agents tools by exporting `tools` from its preset. The conductor collects every addon's tools and serves them through its own MCP server, `bakers-conductor`, on `127.0.0.1`. Every claude and codex run gets that server in its MCP config at launch, with a bearer token in `BB_CONDUCTOR_TOKEN`; the token binds each call to the run's worktree and ticket.

```ts
import type { Preset } from '@bakers-build/conductor/contract';

export const tools: Preset['tools'] = {
  contract: 1,
  tools: {
    hello_where: {
      description: 'The worktree this run works in.',
      // Optional; a flat input like an inbox message's. Unknown keys are refused.
      input: { type: 'object', properties: { note: { type: 'string' } } },
    },
  },
  handlers: async (options) => ({
    hello_where: async (req) => ({ text: req.worktreePath }),
  }),
};
```

- A handler gets `{ worktreePath, ticket, args, signal, logger, callTool }` and returns `{ text }`; a thrown error reaches the agent as a tool error.
- The worktree always comes from the caller's binding, never from an argument. Do not declare a worktree, path or URL input that widens what a tool can reach.
- `callTool(name, args)` calls another addon's tool on the same worktree. Inbox handlers get `callTool` too.
- A tool name declared by two addons stops the conductor at start. `handlers` gets the entry's `with`.
- Only `bakers oven start` (the serve process) runs the server, and only when some addon declares tools. It writes `<BB_HOME>/conductors/<conductor_id>.json` (mode 0600) with the URL and an operator token; a CLI command, such as `bakers ports up`, uses it to call a tool for a worktree under the conductor's checkout.

## How runs get the server

- **claude**: `bakers-conductor` (type `http`, header `Authorization: Bearer ${BB_CONDUCTOR_TOKEN}`) is merged into `--mcp-config`, beside `sandbox.mcp_servers` in the sandbox mode and on its own in `system`, `yolo` and `custom`. A measured run stays without MCP servers.
- **codex**: `-c mcp_servers.bakers-conductor.url=…` and `-c mcp_servers.bakers-conductor.bearer_token_env_var="BB_CONDUCTOR_TOKEN"`; the sandbox never switches this server off.
- **grok, opencode, pi and kimi** load no MCP server for it. Their runs call the tools through the shell with [`bakers oven tools`](../../configuration/project/conductor-commands.md#tools), which works in grok's sandbox mode too (`Bash(*)` is allowed; `MCPTool(*)` stays denied).

Every run with a tool server has `BB_CONDUCTOR_URL` and `BB_CONDUCTOR_TOKEN` in its environment. The token is never in argv or the launch log, and it is revoked when the run is finalised.

A grok `shell_environment_policy` with `ignore_default_excludes = false` drops `*TOKEN*` variables from grok's shell; `bakers oven tools` then finds no token and exits 4.

## Shipped tools

| Tool | Addon | Does |
|---|---|---|
| `ports_up(service?)` | Ports | Shares a service the worktree claims and returns its URL; every eligible one without `service`. Any other key, URL or IP is refused with the claimed keys. |
| `ports_down(service?)` | Ports | Takes a tunnel down; every tunnel of the worktree without `service`. |
| `ports_status()` | Ports | The worktree's tunnels as JSON rows: `service`, `status`, `local`, `url`. |
| `ports_reap()` | Ports | Drops routes whose worktree or service is gone. |
| `ddev_status()` | DDEV | `ddev describe` as a summary: name, status, primary URL, services. |
| `ddev_start()` | DDEV | `ddev start`, up to 10 minutes. |
| `ddev_exec(command)` | DDEV | Runs `command` in the web container, up to 5 minutes. |
| `provision_up(profile?)` | Conductor | Runs the [`provision_up` hook](/configuration/provisioning/hooks#provision-on-an-agent-s-request), or its `profile` command, in the worktree, up to 30 minutes; offered only when the hook is set. |

The ddev tools and `provision_up` answer with the exit code and the last 64 KB of output; a non-zero exit is a tool error. `bakers ports up`, `down`, `status` and `reap` call the ports tools through the endpoint file, so the conductor stays the only writer of the tunnel routes.
