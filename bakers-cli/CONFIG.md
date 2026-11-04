# bakers.build configuration

The maintained reference is [Configuration](../docs/configuration/index.md).

A machine is an id plus a label: `bakers init` generates a UUID `machine_id` for a new machine in
`~/.bakers/machine.config.js` (an existing machine keeps its id) and asks for its `label`. A conductor is machine + project +
variant (the config file's stem): bakers derives its `conductor_id` as
`<machine_id>-<project>-<variant>` at runtime and never writes it to a config. See [Machines](../docs/configuration/machine.md) and
[Conductor configuration](../docs/configuration/project.md).

The herdr executor runs the agent command with non-interactive `sh`. The harness
binary must resolve through `PATH`; a shell alias or function is not loaded.
See [Conductor configuration](../docs/addons/herdr/options.md).

Interactive conductor starts may offer to install a newer CLI and migrate configuration.
The prompt, cache window, rerun, and `--no-update-check` opt-out are in
[Update bakers.build](../docs/configuration/machine/updates.md).

Conductor lifecycle hooks, including `on_freeze` and `on_resume`, are in
[Hooks](../docs/configuration/provisioning/hooks.md).

[Command reference](../docs/configuration/clients/cli.md) · [Addon contracts](../docs/addons/build/contracts.md)

Grok uses the Grok CLI's default model unless explicitly pinned. Configure the pin in
`machine.config.js`; see [Harnesses](../docs/configuration/agents/reference.md#harnesses).
