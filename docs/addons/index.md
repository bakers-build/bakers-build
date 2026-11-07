# Addons

Extend bakers.build through supported packages. Start with the [catalog](/addons/catalog) when a shipped addon already does the job, then [configure it](/addons/configure) in the permitted file.

## Choose an extension point

| You need to extend | Use |
|---|---|
| Worktree/run preparation or cleanup | A project lifecycle listener |
| Agent access to an operation | [Agent tools](/addons/build/tools) |
| Ticket actions with replies | [Inbox messages](/addons/build/actions) |
| Agent harness, executor, workspace or remote | A conductor plugin |
| CLI commands or connection behavior | Command or connection contributions |
| Terminal ticket UI | [A tab](/addons/bakers-ui/tabs) |

A package can contribute several plugins through its preset. [Contracts](/addons/build/contracts) defines the surfaces, loading order, scopes and interfaces.

[Build your first addon](/addons/build/first-addon) for a complete small lifecycle example: two files, project enabling and a visible success check. No product fork is needed.

Keep preparation behavior in [Provision](/provision/) and access decisions in [Security](/security/). Addons run code on the worker; review them with the same care as project configuration.
