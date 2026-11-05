# DDEV login links for test personas

Read when a run checks or hands over a web surface as a named persona.

A persona is a test account by name (`north-lead`). Its one-time login link comes from the
worktree, against the base URL the reviewer can reach:

```bash
ddev drush uli --name north-lead --uri <reachable base url>
```

In a run with the conductor's tools, run the same command through `ddev_exec` (`drush uli --name
north-lead --uri <url>`) and take a tunnel URL from `ports_status`.

Use the worktree's local URL, or its live tunnel URL when `bakers ports status` shows one; a link to
a host the reviewer cannot reach is no access. Check once that the persona exists
(`ddev drush user:information north-lead`). Where account names are anonymised, the project's test
user list gives the uid instead: `ddev drush uli --uid <uid> --uri <url>`.

`anonymous` gets the plain URL. A persona that is expected to be denied still gets its link: the
denial is what the reviewer should see. A persona that does not exist is reported as **missing**;
never log in as an administrator or another persona instead, and create no account here.

Links expire and are access, not evidence: issue them fresh for each handover, show them unchanged
with persona and environment, and keep them out of durable evidence beyond that handover.
