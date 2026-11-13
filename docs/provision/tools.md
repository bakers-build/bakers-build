# Tools and integrations

Tools let a restricted agent perform the work it needs without granting its shell general host access. The agent requests an operation with named inputs; the conductor or integration executes it and returns a result or error.

## Work across permissions and isolation

[Agent permissions](/provision/security/execution) govern which actions the harness allows. [Isolation](/agents/isolation) limits the environment visible to the agent process. Configure both, then supply tools for operations that need a different environment or credential.

| Required operation | Tool path | What stays outside the agent's shell |
|---|---|---|
| Prepare or reuse the application | `provision_up(profile)` | The configured provisioning command and its host access |
| Push, prepare a PR, inspect checks | [Forge tools](/addons/forge) | The conductor's forge credential |
| Run application checks | `provision_exec(key, args)` | The project-configured command, for example in the web container with that container's mounts and rights |
| Share a preview | `ports_up(service)` | The configured tunnel integration |

For example, an agent can edit its worktree, request the `test` provisioning profile, run application checks through `provision_exec` and prepare a PR through Forge. It needs access to those tools, not a blanket `docker`, `git` or `bakers` shell exemption. The selected tool must be available and permitted by the harness; isolation alone grants no tool access.

The tool is an explicit path **across** a boundary, not an extension of the agent sandbox. Review three things:

- **Call authorization:** which operations and inputs the integration accepts for this run, ticket and project.
- **Execution authority:** where the implementation runs, which files it mounts and which credentials it holds. Keep credentials with the integration when the agent does not need their values.
- **Returned data and editable code:** results enter the agent/model context. A host-side tool loading agent-editable scripts can execute that code with host rights.

A fixed tool name or profile does not itself make execution safe. `ddev_status()` is a status query; `provision_exec('web', [...])` runs the project's configured command with the agent's arguments, which for a site container can mean any command there. Their authority differs. Scope the tool implementation and its environment to the intended job.

## Where tools come from

An agent program has its own tools, such as reading files or running shell commands. bakers.build also supplies tools for the ticket environment, and [addons](/addons/) can extend them.

| Provider | Example | Purpose |
|---|---|---|
| bakers.build | `provision_up(profile?)`, `provision_exec(key, args?)` | Prepare or reuse the worktree's application environment; run a configured command, for example in its site container |
| [Agents addon](/addons/agents) | `agents_catalog()` | Read the conductor's loaded agent catalog and routes without permissions |
| [DDEV addon](/addons/ddev#agent-tools) | `ddev_status()`, `ddev_start()` | Inspect and start a DDEV project |
| [Ports addon](/addons/ports) | `ports_up(service?)`, `ports_status()` | Share a preview and inspect its status |

Enable the addons you need in their supported [configuration scope](/addons/configure). `provision_up` and `provision_exec` become available when you configure their [hooks](/configuration/project/hooks#provision-on-an-agent-s-request).

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

The first call on a new worktree can take minutes, and the call waits until the command ends, for up to 30 minutes. Agent harnesses cut MCP tool calls by default: Claude Code's HTTP MCP client after 60 seconds (the server entry's `timeout`, else `MCP_TOOL_TIMEOUT`), Codex after the server's `tool_timeout_sec` (60 seconds by default). bakers.build sets both for its `bakers` server at launch, past the 30-minute provision limit. The limit is the harness's, not the conductor's: a harness launched another way still cuts the call. After a client timeout the command keeps running; a new call with the same profile joins it and returns its result instead of starting the command again.

The command runs outside the agent sandbox with the execution user's rights, including any worktree code it loads. The profile must check readiness and return failures; it is not a containment boundary. See [the security boundary](/provision/security/#provision-up-and-addon-tools) and the [full provisioning contract](/configuration/project/hooks#provision-on-an-agent-s-request).

**Next:** choose both [agent permissions and isolation](/provision/security/), then [verify the project](/provision/guide#verify-independent-operation).
