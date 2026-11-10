# Provision

Run agents, but securely. Choose where they run, connect a project and give each ticket an independent environment with the tools and access it needs.

::: tip Your team already runs tickets?
You can [create a ticket](/get-started/daily-work/create-a-ticket) using that setup. Follow this guide when you want to run agents yourself.
:::

## Set up execution

Start at the first step you have not completed. Keep working tools and project settings.

1. **[Choose where agents run](/provision/machine).** Reuse an existing environment, choose a remote server or use your own computer.
2. **[Prepare your project](/get-started/connect-a-project).** Connect the repository and configure its workflow and worktree environment.
3. **[Run your first ticket](/get-started/first-ticket).** Check the execution setup and read the first result.

## Tools and security

As you prepare the project, decide which operations agents need and what they may access.

<DocQuickLinks aria-label="Tools and security" :items="[
  { label: 'Tools and integrations', text: 'Make operations available to agents, CLI commands and UI actions.', link: '/provision/tools' },
  { label: 'Run agents securely', text: 'Choose a supported security mode and review tool access, including provision_up.', link: '/provision/security/' }
]" />

## Environment examples

Follow the example that matches your existing project. These are starting points, not required environments.

<DocTiles :tiles="[
  { title: 'DDEV', text: 'Separate DDEV projects and addon tools for each ticket.', link: '/provision/examples#ddev', icon: 'layers', meta: 'Explore the DDEV example →' },
  { title: 'Docker Compose', text: 'Separate service identities, ports and data.', link: '/provision/examples#docker-compose', icon: 'layers', meta: 'Explore the Compose example →' },
  { title: 'Node.js', text: 'Run the application directly in each worktree.', link: '/provision/examples#node-js', icon: 'code', meta: 'Explore the Node.js example →' }
]" />

Using another stack? Apply the same [worktree requirements](/provision/guide#make-the-project-worktree-compatible).

<span id="from-ticket-to-cleanup"></span>

## Related guides

Continue here when you need precise command timing or want to operate the application server.

<DocQuickLinks aria-label="Related provision guides" :items="[
  { label: 'Lifecycle hooks', text: 'Connect repeatable project setup and cleanup commands.', link: '/provision/hooks' },
  { label: 'Self-hosting', text: 'Run the bakers.build application server on your own infrastructure.', link: '/self-hosting/' }
]" />
