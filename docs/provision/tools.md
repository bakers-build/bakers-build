# Tools and integrations

Tools make functions available to agents and other callers: check an environment, run a test, prepare an application or share a preview. They connect your project tooling to the people and agents working on tickets.

## What a tool does

A tool has a name, a description and defined input parameters. The caller chooses a tool and supplies its inputs; the implementation performs the operation and returns a result or an error.

For example, `ddev_status()` reports an environment's status. `ddev_exec(command)` accepts a command to run inside its web container. The tool's implementation determines what it can do.

## Where tools come from

An agent program has its own tools, such as reading files or running shell commands. bakers.build also supplies tools for the ticket environment, and [addons](/addons/) can extend them.

| Provider | Example | Purpose |
|---|---|---|
| bakers.build | `provision_up(profile?)` | Prepare or reuse the worktree's application environment |
| [DDEV addon](/addons/ddev#agent-tools) | `ddev_status()`, `ddev_start()`, `ddev_exec(command)` | Inspect, start and work inside a DDEV project |
| [Ports addon](/addons/ports) | `ports_up(service?)`, `ports_status()` | Share a preview and inspect its status |

Enable the addons you need in their supported [configuration scope](/addons/configure). `provision_up` becomes available when you configure its hook.

## Call tools from an agent

bakers.build collects the configured tools and makes them available to runs. A run's calls are bound to its ticket and worktree, so the tool operates on that environment.

Claude and Codex receive the tools through **MCP**, a protocol for listing and calling tools. Other supported harnesses can use [`bakers tools`](/cli/tools) from their shell inside the run. For example:

```sh
bakers tools
bakers tools ddev_status
```

The DDEV addon must be enabled for the second call. Outside a run, `bakers tools` normally connects to the application server's tools; it does not automatically select a local worktree's environment.

## Call tools from outside an agent

An addon can expose the same functionality through a CLI command or a UI action. The addon must provide that entry point; declaring a tool alone does not create every kind of caller.

For example, `bakers ports up` calls the Ports tool through the local running service. An addon's UI action can send a message whose handler calls a tool for the selected ticket. Addons can also call each other's tools on the same worktree.

See [addon tools](/addons/build/tools) and [UI actions and messages](/addons/build/actions) to build these integrations. Local CLI access and ticket actions have their own authentication and access checks; a tool is not automatically a public endpoint.

## Prepare an environment with provision_up

`provision_up` lets an agent request a ready application when a task needs it. Configure your project's command or named profiles using the [Configuration reference](/configuration/project/hooks#provision-on-an-agent-s-request). With a profile named `test`, the agent calls `provision_up` with `profile: 'test'`. The script owns reuse, readiness and the resulting URL.

The command runs outside the agent sandbox. This can let an agent prepare its environment while its own shell remains restricted. The script still runs with the execution user's rights, including any code it loads from the worktree. See [the security boundary](/provision/security/#provision-up-and-addon-tools) and the [full provisioning contract](/configuration/project/hooks#provision-on-an-agent-s-request).

**Next:** [choose the agent's security context](/provision/security/), then return to [project verification](/provision/guide#verify-independent-operation).
