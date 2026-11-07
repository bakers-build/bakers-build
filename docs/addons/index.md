# Addons

Addons extend bakers.build with agents, tools, previews and other integrations. Choose whether to use an existing package or build a capability that is missing.

## Choose your task

Most projects can start with the shipped addons. Developing an addon is a separate path.

<DocTiles :tiles="[
  { title: 'Use an existing addon', text: 'Find an integration for your project, then follow its setup and verification steps.', link: '/addons/catalog', icon: 'plug', meta: 'Browse available addons →' },
  { title: 'Build an addon', text: 'You need a capability that existing packages do not provide. Start with a small working example.', link: '/addons/build/first-addon', icon: 'code', meta: 'Build your first addon →' }
]" />

## Enable an existing addon

Follow the package's own instructions; naming an addon does not install its underlying tools.

1. Find the package in the [catalog](/addons/catalog).
2. [Configure it](/addons/configure) in its supported machine or project scope.
3. Run the checks on its page before using it in a ticket.

<span id="choose-an-extension-point"></span>

::: details Extension points for addon authors
| You need to extend | Use |
|---|---|
| Worktree/run preparation or cleanup | A project lifecycle listener |
| Agent access to an operation | [Agent tools](/addons/build/tools) |
| Ticket actions with replies | [Inbox messages](/addons/build/actions) |
| Agent harness, executor, workspace or remote | A conductor plugin |
| CLI commands or connection behavior | Command or connection contributions |
| Terminal ticket UI | [A tab](/addons/bakers-ui/tabs) |

[Contracts](/addons/build/contracts) defines the surfaces, scopes and interfaces.
:::

## Tools and access

Addons run code on the worker. Understand their operations and review access boundaries before enabling them.

<DocQuickLinks aria-label="Addon tools and access" :items="[
  { label: 'Tools and integrations', text: 'See how addon operations reach agents and external clients.', link: '/provision/tools' },
  { label: 'Run agents securely', text: 'Review the access granted to addons and their tools.', link: '/provision/security/' }
]" />
