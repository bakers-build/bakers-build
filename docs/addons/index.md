# Addons

An **addon** is a JavaScript package that extends bakers.build through its extension API. Its exports declare capabilities such as agent tools, ticket actions, previews or integrations. You can use an installed package or write a local one.

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

## Build a capability

Start with [Build your first addon](/addons/build/first-addon): **Add an agent** and **Add a client** explain packages and presets. Then [extend the control panel](/addons/build/control-panel) with an **Is dirty?** button that checks the ticket's worktree.

To extend the web control panel, an addon declares **messages**: ticket buttons or forms with a result. Bakers renders the controls; the conductor runs the operation. A message can call an agent tool, as Ports' **Share tunnels** calls `ports_up`, or have its own handler.

Continue with [Tools](/addons/build/tools), [Messages](/addons/build/actions) and the [API reference](/addons/build/contracts). Specialized extensions can supply an [executor or workspace](/addons/build/executor-workspace), [lifecycle listeners](/provision/hooks#add-a-listener-from-an-addon), or a [terminal tab](/addons/bakers-ui/tabs).

## Tools and access

Addons run code on the worker. Understand their operations and review access boundaries before enabling them.

<DocQuickLinks aria-label="Addon tools and access" :items="[
  { label: 'Tools and integrations', text: 'See how addon operations reach agents and external clients.', link: '/provision/tools' },
  { label: 'Run agents securely', text: 'Review the access granted to addons and their tools.', link: '/provision/security/' }
]" />
