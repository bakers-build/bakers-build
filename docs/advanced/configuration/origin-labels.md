---
title: Origin labels
description: How an agent step mirrors a ticket's progress as a label on its GitLab origin issue, and how a project renames those labels.
---

# Origin labels

A ticket whose `origin` is a GitLab issue gets its progress mirrored as one label on that issue. An agent step writes it with `glab issue update` just before each state write.

Origin labels come from one table under `WORKFLOW.md › ## bb-phase-transition`; its keys are plain states. A state without a row writes nothing, and without the table no origin label is ever written. The table's labels are the family bakers.build owns on the origin issue: exactly one of them is present at a time, and labels outside the table are untouched.

The default table, which `bb-init-project` writes:

```md
## bb-phase-transition

| State | Origin label |
|---|---|
| qualification | doing |
| plan | doing |
| working | doing |
| review | doing |
| done | review |
```

To use your customer's words, change the labels in the table, for example `in progress` instead of `doing`.

- Only transitions made by an agent step are mirrored; a state changed by hand is not.
- `glab` must be installed and signed in on every machine that runs a conductor for the project.
- Create the labels in the GitLab project first, with a colour and description, so GitLab does not invent them.
