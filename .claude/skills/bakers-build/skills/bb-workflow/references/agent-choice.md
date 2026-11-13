# Propose an agent

Keep/report confirmed defaults or override without lookup. Otherwise read the conductor's loaded
agent catalog through [tool discovery and fallback](tools.md#choose-an-operation).
Use its effective routes and enabled agents; models stay configuration.
Present non-default routes in reported order, recommend by type/recipe with state map; individual
aliases only useful overrides (`agent:<route-or-alias>[@<state>]`). Only default: report current
state or * target, no choice question. Unavailable confirmed targets need decision. Failed/empty
catalog: no proposal, keep defaults.
Only explicit choice confirmation authorizes label write, not general qualification approval.
Use `bakers_ticket_update` labels_add ([tools](tools.md)), preserving unrelated labels; no catalog
bulk sync. Unattended recommendation is advisory, no agent label write.
