---
name: bb-create-project
description: Interview for and create one validated bakers.build project.
---

# Create a project

Collect name, required group, at least one team, an optional description, repository and coder
configuration. The description is one or two sentences of plain text, at most 280 characters,
that a reader sees under the project's name in the listing; ask for it, and when the human skips
it, leave the field out of the write — an invented description reads as the owner's own words.
**The group is create-or-select, and never inferred:** offer the existing groups as the choice,
allow creating a new one, and stop for an answer rather than picking one. A project's group is
where its permissions come from, so a guessed group does not fail — it attaches the project to
the wrong rights, which reads as working until someone is missing access or has too much.
**Creating a group asks for its own optional description** in the same plain-text form and writes
it on the group create. Selecting an existing group writes nothing to that group, so its
description stays as its owner left it. **Teams are chosen the same way:** they decide who works
on the project, so offer the workspace's teams and stop for an answer.

Call the named tools ([tools](../bb-workflow/references/tools.md)); their schemas list every
argument. Find the workspace with `bakers_workspace_list`, its groups with `bakers_group_list` and
its teams with `bakers_team_list`, following `next_offset` until it is null before offering a
choice. Create a new group with `bakers_group_create`, then the project with
`bakers_project_create`: `group`, `name`, `teams`, and `description`, `repository` or
`coder_config` only when given; key and counter are server-owned. Read the project back with
`bakers_project_read` (a created group with `bakers_group_list` and its `group` UUID) and confirm
the stored description is the exact text given, or absent when skipped. Return the created project; do not initialize or dispatch
it.
