# Skills & Workflows

Control how tickets move from a request to checked work. Skills provide instructions, recipes select an engineering method, and the repository's `WORKFLOW.md` supplies project-specific preparation and checks.

Read [how the process works](/skills-and-workflows/guide) for an overview. For setup, [install the skills](/skills-and-workflows/skills) on the machine or client that needs them.

## Choose your task

Review ticket work, adjust project rules or extend the methods available to agents.

<DocQuickLinks aria-label="Workflow tasks" :items="[
  { label: 'Workflows and states', text: 'Understand ticket states and approval gates.', link: '/skills-and-workflows/states' },
  { label: 'Accept results', text: 'Review the outcome and decide what happens next.', link: '/skills-and-workflows/accept-results' },
  { label: 'Types, recipes and labels', text: 'Select the work type, method and ticket labels.', link: '/skills-and-workflows/types-recipes-labels' },
  { label: 'Configure WORKFLOW.md', text: 'Set project preparation, instructions and checks.', link: '/skills-and-workflows/workflow-file' },
  { label: 'Write a recipe', text: 'Add an engineering method for agents to follow.', link: '/skills-and-workflows/recipes' },
  { label: 'Ticket metrics', text: 'Define and record measurements on tickets.', link: '/skills-and-workflows/metrics' }
]" />

[Get started](/get-started/#after-your-first-ticket) owns basic ticket use. [Agents](/agents/) chooses which harness runs each state. [Provision](/provision/) explains how configured preparation commands execute; instructions alone do not create an environment or enforce a sandbox.
