# Addons

An **addon** adds functionality to bakers.build. It can connect an agent, such as [Claude](/addons/claude), or a terminal application, such as [herdr](/addons/herdr); give agents more tools, such as [Ports](/addons/ports) for sharing a preview; or add an operation to a ticket, such as the [Artifacts](/addons/bakers-ui-artifacts) tab. Every shipped addon, the agent addons included, is open source and free.

Addons are JavaScript packages. You enable one by listing it in the `addons` array of your configuration:

```js
addons: ['@bakers-build/addon-bakers-ui-artifacts'],
```

## Choose your task

Most projects can start with the shipped addons. Developing an addon is a separate path.

<DocTiles :tiles="[
  { title: 'Use an existing addon', text: 'Find an integration for your project, then follow its setup and verification steps.', link: '/addons/catalog', icon: 'plug', meta: 'Browse available addons →' },
  { title: 'Build an addon', text: 'Learn what addons can extend, how packages connect to bakers.build, and how to build your own.', link: '/addons/build/first-addon', icon: 'code', meta: 'Build your first addon →' }
]" />

<span id="choose-an-extension-point"></span>

## Tools and access

Addons run code on the worker machine. Understand their operations and review access boundaries before enabling them.

<DocQuickLinks aria-label="Addon tools and access" :items="[
  { label: 'Tools and integrations', text: 'See how addon operations reach agents and external clients.', link: '/provision/tools' },
  { label: 'Run agents securely', text: 'Review the access granted to addons and their tools.', link: '/provision/security/' }
]" />

## Enable an existing addon

Follow the package's own instructions: listing an addon in `addons` does not install its underlying tools.

1. Find the package in the [catalog](/addons/catalog).
2. [Configure it](/addons/configure) in its supported machine or project scope.
3. Run the checks on its page before using it in a ticket.
