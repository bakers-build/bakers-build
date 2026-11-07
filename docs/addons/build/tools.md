# Write an addon with agent tools

An addon gives agents tools by exporting `tools` from its preset. This page is the contract; the shipped example is [Ports](/addons/ports); a runtime addon's page lists its own tools.

## The contract

An addon gives agents tools by exporting `tools` from its preset. The conductor collects every addon's tools and serves them through its own MCP server, `bakers`, on `127.0.0.1`. Every claude and codex run gets that server in its MCP config at launch, with a bearer token in `BB_CONDUCTOR_TOKEN`; the token binds each call to the run's worktree and ticket.

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
- Only `bakers oven start` (the serve process) runs the server, and only when some addon declares tools or the site serves [site tools](#site-tools). It writes `<BB_HOME>/conductors/<conductor_id>.json` (mode 0600) with the URL and an operator token; a CLI command, such as `bakers ports up`, uses it to call a tool for a worktree under the conductor's checkout.

## How runs get the server

- **claude**: `bakers` (type `http`, header `Authorization: Bearer ${BB_CONDUCTOR_TOKEN}`) is merged into `--mcp-config`, beside `sandbox.mcp_servers` in the sandbox mode and on its own in `system`, `yolo` and `custom`. The sandbox allows its tools without a prompt (`mcp__bakers`). A `sandbox.mcp_servers` entry named `bakers` is replaced, with a launch warning. A measured run gets neither the MCP server nor the run variables below, so it has no conductor tools.
- **codex**: `-c mcp_servers.bakers={url=…,bearer_token_env_var="BB_CONDUCTOR_TOKEN"}`. The whole table replaces a `[mcp_servers.bakers]` of your Codex config, with a launch warning; without a tool server that entry is switched off like any other.
- **grok, opencode, pi and kimi** load no MCP server for it. Their runs call the tools through the shell with [`bakers tools`](/configuration/clients/tools), which works in grok's sandbox mode too (`Bash(*)` is allowed; `MCPTool(*)` stays denied).

Every other run with a tool server has `BB_CONDUCTOR_URL` and `BB_CONDUCTOR_TOKEN` in its environment. The token is never in argv or the launch log, and it is revoked when the run is finalised.

A grok `shell_environment_policy` with `ignore_default_excludes = false` drops `*TOKEN*` variables from grok's shell; `bakers tools` then calls the site with the operator's credentials, without the project limit.

## Shipped tools

| Tool | Addon | Does |
|---|---|---|
| `ports_up(service?)` | Ports | Shares a service the worktree claims and returns its URL; every eligible one without `service`. Any other key, URL or IP is refused with the claimed keys. |
| `ports_down(service?)` | Ports | Takes a tunnel down; every tunnel of the worktree without `service`. |
| `ports_status()` | Ports | The worktree's tunnels as JSON rows: `service`, `status`, `local`, `url`. |
| `ports_reap()` | Ports | Drops routes whose worktree or service is gone. |
| `provision_up(profile?)` | Conductor | Brings the worktree's environment up: runs the [`provision_up` hook](/provision/hooks#provision-on-an-agent-s-request), or its `profile` command, in the worktree, up to 30 minutes. `profile` must be one of the configured keys. The project's command reuses a ready environment, starts a stopped one, reinstalls a missing or different one, and prints the base URL. Offered only when the hook is set. |

A runtime addon may add tools of its own; its page lists them.

`provision_up` answers with the exit code and the last 64 KB of output; a non-zero exit is a tool error. `bakers ports up`, `down`, `status` and `reap` call the ports tools through the endpoint file, so the conductor stays the only writer of the tunnel routes.

## Site tools

The `bakers` server also serves the site's ticket tools to every run, under their plain name and with the site's input schema: `bakers_ticket_read`, `bakers_ticket_search`, `bakers_ticket_create`, `bakers_ticket_update`, `bakers_ticket_classify`, `bakers_ticket_transition`, `bakers_comment_publish`, `bakers_metric_write`, `bakers_ticket_list`, `bakers_ticket_runs_list`, `bakers_label_list`, `bakers_project_read` and `bakers_user_read`. The agent addons need no option and no `settings.json` entry for them.

- The conductor calls the site's `/mcp` with its own connection, so the run holds no site credential and `bakers` need not be a trusted command for ticket work ([run security](/security/execution)).
- Every call stays inside the run ticket's project. A `ticket`, `parent`, `referenced_tickets_add` entry or `project` of another project, or a `workspace` other than the project's, is refused with a tool error naming the argument and both projects, and nothing reaches the site. A run whose ticket has no project gets every site tool refused. A missing `project` on `bakers_ticket_search`, `bakers_ticket_list` and `bakers_ticket_create`, and a missing `workspace` on `bakers_label_list`, mean the run's.
- While the site is unreachable the server lists the addon tools alone and logs a warning; the next listing tries again.
- The operator `POST /call` serves no site tools.
