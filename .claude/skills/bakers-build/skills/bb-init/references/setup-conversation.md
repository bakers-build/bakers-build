# Setup conversation

Read by `@bakers-build/bb-init` and `@bakers-build/bb-init-project` before asking anything. Each
skill's decision matrix lists its rows; these rules run them.

- For each applicable row, inspect existing settings and caller answers first. Track its source,
  answer or explicit unresolved status; mark an inapplicable row with its reason. Every row gets a status.
- Name the source of a reused choice. Link the row's documentation whenever explaining a choice;
  explain documented tradeoffs and distinguish supported integrations from planned ones.
- With each question, say in one or two sentences which option fits when: the matrix
  recommendation where the row has one, otherwise the row's documentation. Check an option's
  prerequisites first; for an option that is unavailable here, name the failed prerequisite that
  rules it out and what would make it available.
- Ask for **one field or decision per turn** and wait. Request related follow-up values in later
  turns. Before sending, count requested inputs and keep only the first unanswered field.
  “Answer the first question first” does not permit appending another.
- Unattended, keep unknown choices unresolved and report them.
- A decision belongs to the scope that stores it: machine rows to `bb-init`, project rows to
  `bb-init-project`. Hand a row of the other scope to its skill, then resume.

**Done when every applicable row has a source, an answer, or an explicit unresolved status.**
