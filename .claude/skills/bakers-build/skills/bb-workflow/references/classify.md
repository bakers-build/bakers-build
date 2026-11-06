# Classify: recipe and type

Read at qualification's *work*, after both prior-art checks.

List the installed `bb-recipe-*` skills and load each one's **complete** `SKILL.md`: its method,
declared types and state slots, never its description alone. Read any recipe guidance the project's
`WORKFLOW.md` gives; it may give none. Choose the recipe whose method and declared types fit the ask
best. Ask only when a human is present and two recipes fit equally, and write nothing until the
answer; an unattended run decides by fit itself. Then choose a type that recipe declares.

Write both in one `bakers_ticket_classify` call ([tools](tools.md)) with `recipe` (the suffix only:
`<name>` for `bb-recipe-<name>`) and `type`; it reuses or creates the terms and returns the saved
names. Read back `recipe` and `type`. Write no `work:*` or `method:*` label and create no term by
hand. Classification publishes no comment and transitions nothing; the handoff records both choices
and the reason for the recipe, named from what its method does.
