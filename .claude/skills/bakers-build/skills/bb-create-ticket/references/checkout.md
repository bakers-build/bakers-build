# Steps in a checkout

Only for a host with a checkout of the project, before the create.

- **Parent:** an explicit intake parent wins. Otherwise search tickets by this checkout's branch name
  and the project, and propose the one match as `parent`; a rejection means none, and several
  matches are a question. `base_branch` follows from the parent; never write it.
- **Conductor:** with none supplied, propose one from the project's conductors; an explicit choice
  of none writes nothing. The intake's or chosen conductor is the host's: outside a hand-over, set
  it after routing.
- **Agent:** apply [agent choice](../../bb-workflow/references/agent-choice.md).
- **Origin:** before each route, publish authorized
  [origin status](../../bb-workflow/references/origin-status.md).
