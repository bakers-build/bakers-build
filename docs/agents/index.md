# Agents

Configure agents on an execution machine, then select one by its alias. The guide separates these two tasks.

<span id="choose-your-task"></span>
<span id="add-an-agent"></span>
<span id="configure-machine-and-project-settings"></span>
<span id="select-an-agent-on-a-ticket"></span>

<DocTiles :tiles="[
  { title: 'Configure agents', text: 'Choose one agent from the catalog or agent routes. Follow a complete machine-file example.', link: '/agents/guide#configure-agents', icon: 'terminal', meta: 'Choose your setup →' },
  { title: 'Select an agent', text: 'Use the machine default, an alias label or a route label.', link: '/agents/guide#select-an-agent', icon: 'ticket', meta: 'Choose what runs →' }
]" />

[Configuration → Machine](/configuration/machine#agents) explains file ownership and agent settings; [Agent policy reference](/agents/reference) contains the complete fields and precedence rules.

<span id="route-work-to-different-agents"></span>

For different selections per workflow state, follow [Use agent routes](/agents/guide#use-agent-routes).

<span id="provide-tools-and-access"></span>

## Tools and access

<DocQuickLinks aria-label="Agent tools and access" :items="[
  { label: 'Tools and integrations', text: 'Understand which operations addons make available to agents.', link: '/provision/tools' },
  { label: 'Run agents securely', text: 'Review security modes and the access granted to tools.', link: '/provision/security/' }
]" />
