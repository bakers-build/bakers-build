# Agents

Configure agents on an execution machine, then select one by its alias. The guide separates these two tasks.

<span id="choose-your-task"></span>
<span id="add-an-agent"></span>
<span id="configure-machine-and-project-settings"></span>
<span id="select-an-agent-on-a-ticket"></span>

<DocTiles :tiles="[
  { title: 'Configure agents', text: 'Enable a harness addon, configure an agent plugin and give it an alias.', link: '/agents/guide#configure-agents', icon: 'terminal', meta: 'Configure an agent →' },
  { title: 'Select an agent', text: 'Choose an alias as the machine default or through a ticket label.', link: '/agents/guide#select-an-agent', icon: 'ticket', meta: 'Choose what runs →' }
]" />

[Agent policy reference](/agents/reference) contains the complete fields, defaults, precedence and machine configuration example.

<span id="route-work-to-different-agents"></span>

For different selections per workflow state, follow [Add a route](/agents/guide#add-a-route).

<span id="provide-tools-and-access"></span>

## Tools and access

<DocQuickLinks aria-label="Agent tools and access" :items="[
  { label: 'Tools and integrations', text: 'Understand which operations addons make available to agents.', link: '/provision/tools' },
  { label: 'Run agents securely', text: 'Review security modes and the access granted to tools.', link: '/provision/security/' }
]" />
