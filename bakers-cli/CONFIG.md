# bakers.build configuration

The maintained reference is [Configuration](../docs/advanced/configuration/index.md).

The herdr executor runs the agent command with non-interactive `sh`. The harness
binary must resolve through `PATH`; a shell alias or function is not loaded.
See [Conductor configuration](../docs/advanced/conductor-config.md#herdr-options).

Interactive conductor starts may offer to install a newer CLI and migrate configuration.
The prompt, cache window, rerun, and `--no-update-check` opt-out are in
[Update bakers.build](../docs/advanced/configuration/update.md).

Conductor lifecycle hooks, including `on_freeze` and `on_resume`, are in
[Hooks](../docs/advanced/configuration/hooks.md).

[Command reference](../docs/advanced/cli/index.md) · [Addon contracts](../docs/addons/build/contracts.md)

Grok uses the Grok CLI's default model unless explicitly pinned. Configure the pin in
`machine.config.js`; see [Harnesses](../docs/advanced/machines.md#harnesses).
