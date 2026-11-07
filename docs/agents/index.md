# Agents

Agents work on tickets using the instructions and tools you provide. An addon starts the chosen agent program, such as Claude Code or Codex, with its model and security settings.

## Choose your task

Use a configured agent for a ticket, or change what the execution machine offers.

<DocTiles :tiles="[
  { title: 'Select for a ticket', text: 'The machine already has agents. Choose an alias or route using a ticket label.', link: '#select-an-agent-on-a-ticket', icon: 'ticket', meta: 'Choose a ticket agent →' },
  { title: 'Set up agents', text: 'Add an installed harness, choose models and check the machine catalog.', link: '/agents/guide', icon: 'terminal', meta: 'Configure agents and models →' }
]" />

## Add an agent

The **harness** runs the agent session. Install and sign in to it on the execution machine, then enable its [addon](/addons/catalog#agents). An **alias**, such as `codex` or `opus`, names an agent and model.

## Configure machine and project settings

The machine owns harness addons, aliases, defaults and routes. The project defines its workflow, environment and additional tools. Both can set shared security policy. [Configuration reference](/agents/reference) explains ownership.

## Route work to different agents

A route assigns agents to workflow states, such as Codex for implementation and Opus for review. Add [routing](/agents/guide) when states need different agents.

## Select an agent on a ticket

Use a ticket label with the lowercase prefix `agent:`.

- `agent:codex` selects that alias.
- `agent:careful` selects a configured route named `careful`.
- `agent:opus@review` selects Opus only in review.

[Selection rules](/agents/reference#which-agent-runs-a-state)

## Provide tools and access

Each run has a security context and available tools. Review the security settings before extending access.

<DocQuickLinks aria-label="Agent tools and access" :items="[
  { label: 'Tools and integrations', text: 'Understand which operations addons make available to agents.', link: '/provision/tools' },
  { label: 'Run agents securely', text: 'Review security modes and the access granted to tools.', link: '/provision/security/' }
]" />
