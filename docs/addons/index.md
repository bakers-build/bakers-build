# Addons

An **addon** adds functionality to Bakers: it can connect an agent or terminal application, give agents more tools, or make an operation available from a ticket. Addons are JavaScript packages that you enable in configuration. You can use an existing package or write your own.

## Choose your task

Most projects can start with the shipped addons. Developing an addon is a separate path.

<DocTiles :tiles="[
  { title: 'Use an existing addon', text: 'Find an integration for your project, then follow its setup and verification steps.', link: '/addons/catalog', icon: 'plug', meta: 'Browse available addons →' },
  { title: 'Build an addon', text: 'Learn what addons can extend, how packages connect to Bakers, and how to build your own.', link: '/addons/build/first-addon', icon: 'code', meta: 'Build your first addon →' }
]" />

## Enable an existing addon

Follow the package's own instructions; naming an addon does not install its underlying tools.

1. Find the package in the [catalog](/addons/catalog).
2. [Configure it](/addons/configure) in its supported machine or project scope.
3. Run the checks on its page before using it in a ticket.

<span id="choose-an-extension-point"></span>

## Build a capability

Start with [Build your first addon](/addons/build/first-addon) for the concepts: what an addon is, which parts of Bakers it can extend, and how its JavaScript package is loaded. The examples then show how to add an agent or connect a terminal client.

To [extend the control panel](/addons/build/control-panel), an addon declares **messages**: ticket buttons or forms with a result. Bakers renders the controls; the conductor runs the operation. A message can call an agent tool or have its own handler.

Continue with [Tools](/addons/build/tools), [Messages](/addons/build/actions) and the [API reference](/addons/build/contracts). Specialized extensions can supply an [executor or workspace](/addons/build/executor-workspace), [lifecycle listeners](/provision/hooks#add-a-listener-from-an-addon), or a [terminal tab](/addons/bakers-ui/tabs).

## Tools and access

Addons run code on the worker. Understand their operations and review access boundaries before enabling them.

<DocQuickLinks aria-label="Addon tools and access" :items="[
  { label: 'Tools and integrations', text: 'See how addon operations reach agents and external clients.', link: '/provision/tools' },
  { label: 'Run agents securely', text: 'Review the access granted to addons and their tools.', link: '/provision/security/' }
]" />
