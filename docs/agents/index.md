# Agents

An **agent** is the coding agent that works a ticket on your worker machine, with your own subscription to its provider. Each one comes as an addon that connects its harness: [Claude Code](/addons/claude), [Codex](/addons/codex), [Grok Build](/addons/grok), [Kimi Code](/addons/kimi), [OpenCode](/addons/opencode) and [pi](/addons/pi).

You give each configured agent and model an **alias**, such as `coder` or `opus`; the aliases on a machine form its **catalog**. A **route** maps workflow states to aliases, so a different agent can run each state, for example one model for working and another for review. An `agent:` **label** on the ticket, added by whoever edits it, picks an alias or a route for that ticket. Without a label or a `default` route, the machine's `default_agent` runs, and without that, the first agent in the catalog. A machine with no agent addon runs no agent.

<span id="choose-your-task"></span>
<span id="add-an-agent"></span>
<span id="configure-machine-and-project-settings"></span>
<span id="select-an-agent-on-a-ticket"></span>

<DocTiles :tiles="[
  { title: 'Configure agents', text: 'Add agents to the catalog and, if you want, routes per workflow state. Includes a complete machine-file example.', link: '/agents/guide#configure-agents', icon: 'terminal', meta: 'Choose your setup →' },
  { title: 'Select an agent', text: 'Rely on the machine default, or add an alias or route label to a ticket.', link: '/agents/guide#select-an-agent', icon: 'ticket', meta: 'Choose what runs →' }
]" />

[Configuration → Machine](/configuration/machine#agents) explains file ownership and agent settings; [Agent policy reference](/agents/reference) contains the complete fields and precedence rules.

<span id="route-work-to-different-agents"></span>

For different agents per workflow state, follow [Use agent routes](/agents/guide#use-agent-routes).

<span id="provide-tools-and-access"></span>

## Tools and access

<DocQuickLinks aria-label="Agent tools and access" :items="[
  { label: 'Tools and integrations', text: 'Understand which operations addons make available to agents.', link: '/provision/tools' },
  { label: 'Run agents securely', text: 'Review security modes and the access granted to tools.', link: '/provision/security/' }
]" />
