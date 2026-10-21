# Propose an agent

Run `gaia agents` in the current ticket worktree. Its JSON supplies routes, default_agent,
enabled_agents, disabled_agents and the effective alias/description/harness/model catalog.
Treat models as configuration, never prompt literals or labels.

Present named routes first, excluding reserved `default`, in reported order. Recommend a route
from work types and selected method guidance, explaining its state map. Offer individual aliases
only as useful overrides. Use `agent:<route-or-alias>` or `agent:<route-or-alias>@<state>`.

With only default, report the current-state or `*` target; ask no meaningless route choice.
Preserve confirmed choices and report unavailable targets for a decision. A failed catalog lookup
or empty catalog produces no proposal; continue with existing defaults.

Write a proposed label only after explicit confirmation of that choice; general qualification
approval does not authorize an unstated override. Ensure the confirmed term exists, use
`--label_names`, and preserve unrelated labels. Do not bulk-sync catalog entries.
An unattended run writes no agent label; its recommendation remains advisory.
