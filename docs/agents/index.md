# Agents

Choose which agent works on a ticket, or configure the choices offered by an execution machine. Start with the guide to understand agents, models and routes.

## Choose your task

<DocTiles :tiles="[
  { title: 'Understand and set up agents', text: 'Learn the concepts, create a route and verify a ticket run.', link: '/agents/guide', icon: 'terminal', meta: 'Follow the guide →' },
  { title: 'Select for a ticket', text: 'Choose an existing alias or route with a ticket label.', link: '/agents/guide#select-a-route-or-an-alias', icon: 'ticket', meta: 'Choose a ticket agent →' }
]" />

## Add an agent

Follow the guide's [prerequisites and catalog check](/agents/guide#manual-configuration-and-what-it-controls); it links the vendor-specific setup instructions.

## Configure machine and project settings

[Agent policy reference](/agents/reference) owns fields, defaults, precedence and the complete machine configuration example.

## Route work to different agents

Follow [Add a route](/agents/guide#add-a-route) for a small example and its explanation.

## Select an agent on a ticket

Follow [Select a route or an alias](/agents/guide#select-a-route-or-an-alias), then verify the actual run.

## Provide tools and access

<DocQuickLinks aria-label="Agent tools and access" :items="[
  { label: 'Tools and integrations', text: 'Understand which operations addons make available to agents.', link: '/provision/tools' },
  { label: 'Run agents securely', text: 'Review security modes and the access granted to tools.', link: '/provision/security/' }
]" />
