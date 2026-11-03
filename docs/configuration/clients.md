# Clients

Choose your TUI or client during [project setup](/get-started/connect-a-project#choose-your-tui). It organizes tickets, agent sessions and worktrees. The [project environment](/configuration/provisioning) runs the application and its dependencies; Claude/Codex are the agents that do the work.

| Client | Purpose | Canonical setup |
|---|---|---|
| OAuth-capable MCP chat | Create, read and plan without a developer installation | [Connector](/get-started/connector) |
| bakers.build website | Follow progress, read summaries, verdicts and time | Your server's `/user/login` |
| `bakers ui` | Terminal ticket cockpit | [Terminal UI](/addons/bakers-ui) |
| herdr | Local terminals and worktrees | [herdr](/addons/herdr) |
| Orca | Local worktree UI, diff review and terminals | [Orca](/addons/orca) |

## Ownership and selection

The local client owns its installation and running session. `.bakers/conductor.config.js` owns the required executor/workspace pairing. Choose one supported pair; their optional layouts, labels and timeouts are documented with the addon.

For example, this fragment selects herdr alongside the server remote:

```js
addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
```

For Orca, use its [canonical configuration](/addons/orca). Git-only workspace is a [workspace provider](/addons/workspace-git), requiring a compatible executor; it does not replace a terminal manager by itself. Environment hooks also do not provide an executor.

## Verify

Run the selected client's readiness check as the conductor user, then:

```sh
bakers config check --scope project
bakers oven check
```

Start a small ticket and confirm its terminal opens in the selected client and its summary appears in the cockpit or web UI. [First ticket](/get-started/first-ticket) defines success.

[CLI commands](/configuration/clients/cli), [troubleshooting](/configuration/clients/troubleshooting), and [migration from the old CLI](/configuration/clients/switch-to-bakers) are supporting references.
