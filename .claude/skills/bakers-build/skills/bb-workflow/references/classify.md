# Classify: recipe and type

Read at qualification's *work*, after both prior-art checks.

Read the descriptions of the installed `bb-recipe-*` skills. Choose the recipe whose description fits
the ask; with no clear signal, the one declaring itself project default. Ask only on real
ambiguity — two recipes that fit equally — and write nothing until the answer; an unattended run
takes the default. Then choose a type that recipe declares.

Write both in one `bakers_ticket_classify` call ([tools](tools.md)) with `recipe` (the suffix only:
`matt` for `bb-recipe-matt`) and `type`; it reuses or creates the terms and returns the saved names.
Read back `recipe` and `type`. Write no `work:*` or `method:*` label and create no term by
hand. Classification publishes no comment and transitions nothing; the handoff records both choices
and the reason for the recipe.
