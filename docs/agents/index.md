# Agents

An **agent** is the coding agent that works a ticket on your worker machine, with your own subscription to its provider. Each one comes as an addon that connects its harness: [Claude Code](/addons/claude), [Codex](/addons/codex), [Grok Build](/addons/grok), [OpenCode](/addons/opencode) and [pi](/addons/pi). All of them are ordinary addons, so you can add any other agent program the same way: [Add a new agent harness](/addons/build/add-a-new-agent-harness) walks through a complete example. A machine with no agent addon runs no agent.

<span id="choose-your-task"></span>
<span id="add-an-agent"></span>
<span id="configure-machine-and-project-settings"></span>
<span id="select-an-agent-on-a-ticket"></span>
<span id="route-work-to-different-agents"></span>
<span id="provide-tools-and-access"></span>

<DocTiles :tiles="[
  { title: 'Agents and agent routes', text: 'Name agent configurations as aliases, map workflow states to them with routes, and pick one per ticket with an agent: label.', link: '/agents/configure-and-select-agents', icon: 'git-branch', meta: 'Configure and select →' },
  { title: 'Permissions and isolation', text: 'How permissions, sandboxes, runtimes and tools fit together, with detail pages for each and support per agent and platform.', link: '/agents/permissions-and-isolation', icon: 'layers', meta: 'Choose a boundary →' },
  { title: 'Tools', text: 'See which operations agents can call through addons, and how they cross the isolation boundary.', link: '/provision/tools-and-integrations', icon: 'plug', meta: 'Understand tools →' }
]" />

[Agent policy reference](/agents/agent-policy-reference) lists every field and precedence rule; [Isolation models](/agents/isolation-models) compares every boundary in detail.
