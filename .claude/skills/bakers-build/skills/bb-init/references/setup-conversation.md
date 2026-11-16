# Setup conversation

Read by `@bakers-build/bb-init` and `@bakers-build/bb-init-project` before asking anything. Each
skill's decision matrix groups its rows into **blocks**; these rules run them.

## Derive first

- For each applicable row, inspect existing settings, caller answers and the row's **Derive from**
  evidence first. Track each row's source, answer or explicit unresolved status; mark an
  inapplicable row with its reason. Every row gets a status.
- Collect evidence with read-only commands only. Missing, failing or ambiguous evidence (two
  remotes, no merged requests, a signed-out forge CLI) derives nothing: ask that value.
- Link the row's documentation whenever explaining a choice; explain documented tradeoffs and
  distinguish supported integrations from planned ones. Check an option's prerequisites first;
  for an option that is unavailable here, name the failed prerequisite and what would make it
  available.

## One block per turn

- Ask **one block per turn** and wait. The question previews every value the block writes, per
  target file, one line each: `key: value — source`, the source being the evidence command or
  file, `recommended` or `your answer`. An open value reads `key: ? — asked`. Name each value:
  every lifecycle hook, `provision_up` profile, readiness check and `provision_exec` key.
- Beside each term a row explains, put its **Explain** sentence; say in one sentence which option
  fits when: the row's recommendation, otherwise its documentation.
- Options: **Take proposal** (recommended); a named variant where the row lists one; **Adjust**.
  Taking answers exactly the values the preview names; a value it omits stays unanswered and is
  reported. Adjust asks the chosen values singly, one per turn.
- **Own decisions**: permission mode, grants, merge policy, forge authentication and the server group are each asked alone, first in their block, never inside Take proposal; the block preview then shows them as `answered:`.
- Unattended, keep unknown choices unresolved and report them.
- A decision belongs to the scope that stores it: machine blocks to `bb-init`, project blocks to
  `bb-init-project`. Hand a row of the other scope to its skill, then resume.

## Read syntax in full

The documentation owns configuration syntax. Read a linked page as its Markdown source, the
`https://bakers.build/<path>.md` its link names, with a full-text fetch such as `curl -fsSL`;
a summarising fetch drops syntax. Inside a bakers.build source checkout read `docs/<path>.md`
instead, to match the revision, together with the `options.schema.json` that an
`<!-- @options <package> -->` line names. A page that cannot be read leaves its rows unresolved;
report its URL.

**Done when every applicable row has a source, an answer, or an explicit unresolved status.**
