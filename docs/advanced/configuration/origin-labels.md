---
title: Origin labels
description: How an agent step mirrors a ticket's progress as a label on its GitLab origin issue, and how a project renames those labels.
---

# Origin labels

A ticket whose `origin` is a GitLab issue gets its progress mirrored as one label on that issue. An agent step writes it with `glab issue update` just before each state write, and removes the other labels of the same family.

| Ticket state | Label on the issue |
|---|---|
| `qualification`, `plan`, `working`, `review` | `doing` |
| `done` | `review` |

Other states write nothing. To use your customer's words, override the map in the `## transition` section of `WORKFLOW.md`. A `<workflow>:<state>` key such as `bb_verification:done` wins over the bare state, and the map's values are the label family bakers.build owns:

```md
## transition

`@bakers-build/bb-publish-origin-status` `origin_labels.data`:

    qualification: in progress
    plan: in progress
    working: in progress
    review: in progress
    done: ready for review
```

- Only transitions made by an agent step are mirrored; a state changed by hand is not.
- `glab` must be installed and signed in on every machine that runs a conductor for the project.
- Create the labels in the GitLab project first, with a colour and description, so GitLab does not invent them.
