---
name: create-project
description: Interview for and create one validated bakers.build project.
---

# Create a project

Collect name, required group, an optional description, repositories, coder configuration, and
optional members. The description is one or two sentences of plain text, at most 280 characters,
that a reader sees under the project's name in the listing; ask for it, and when the human skips
it, leave the field out of the write — an invented description reads as the owner's own words.
**The group is create-or-select, and never inferred:** offer the existing groups as the choice,
allow creating a new one, and stop for an answer rather than picking one. A project's group is
where its permissions come from, so a guessed group does not fail — it attaches the project to
the wrong rights, which reads as working until someone is missing access or has too much.
**Creating a group asks for its own optional description** in the same plain-text form and writes
it on the group create. Selecting an existing group writes nothing to that group, so its
description stays as its owner left it.

Resolve relationship UUIDs and list what may be set with `--fields`. Create the project by naming
those fields directly on the live create, omitting server-owned key and counter fields. Write a
description as the scalar `--description '<text>'`, never as `description.value` or
`description.format`: it is a plain string, and the rich-text form is refused. Read the created
project (and a created group) back by its returned UUID and confirm the stored description is the
exact text given, or absent when skipped. Return the created project; do not initialize or dispatch
it.
