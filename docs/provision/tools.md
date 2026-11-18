# Tools and integrations

<span id="work-across-permissions-and-isolation"></span>

## Why tools?

In a sandbox the agent may not run `docker`, `git push` or open a preview. So it asks bakers.build, and bakers.build does it outside the sandbox with its own credentials. The agent gets the result, never the credentials.

## What the agent can ask for

- <span id="prepare-an-environment-with-provision-up"></span>Start the app for this ticket (`provision_up`).
- Run a fixed project command, such as tests or lint, in the app container (`provision_exec`).
- Push, open a merge request and read CI ([Forge tools](/addons/forge)).
- Share a preview link (`ports_up`).

Addons add more, for example the [DDEV](/addons/ddev#agent-tools) and [Agents](/addons/agents) addons.

## Caution

Tools run with your rights, outside the sandbox. Configure only commands you trust, and prefer fixed `provision_exec` keys without `args`.

<span id="where-tools-come-from"></span><span id="call-tools-from-an-agent"></span>

## How to enable

- Enable the addons you need in their [configuration scope](/addons/configure).
- `provision_up` and `provision_exec` appear once you configure their [hooks](/configuration/project/hooks#provision-on-an-agent-s-request).
- Claude and Codex get the tools through MCP; other harnesses call [`bakers tools`](/cli/tools) from their shell.
- More: [call tools from outside an agent](/addons/build/tools#call-tools-from-outside-an-agent) and [how long `provision_up` may take](/configuration/project/hooks#provision-on-an-agent-s-request).

**Next:** choose [agent permissions and isolation](/agents/security), then [verify the project](/provision/guide#verify-independent-operation).
