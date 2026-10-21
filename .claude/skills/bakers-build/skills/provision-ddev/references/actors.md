## DDEV actor resolution

The caller supplies qualification's complete actor requirements. Resolve every actor, including
ones expected to be denied. For an authenticated actor, the specification may name a role, uid,
or meaningful fixture name. Names are reliable only in known named-fixture worlds such as a
fresh `recipe-test` world: anonymisation scrambles names/mail while uid survives. Resolve to uid
with `ddev drush user:information`, confirming stored name, roles, and relevant access against
the requirement. Ambiguous role matches remain unresolved until a configured fixture or choice
selects the account; never substitute admin.

Return the [shared actor/access records](../../method-context/references/results.md), carrying
uid, stored name and roles with the account, environment and lookup source. Preserve anonymous
actors explicitly, with no login command; `not_required` means no actor requirement. A denied
actor remains a real resolved identity whose expected observation is denial. Failed lookups
remain `unresolved` with reasons. Account creation belongs to project provisioning, never this
lookup.

Compose authenticated access as:

```text
ddev drush uli --uri <reachable base url> --uid <uid>
```

Use the base URL reachable by the reviewer: the worktree's local URL or its live tunnel URL.
Run `bakers ports status` in the worktree; an empty result means no tunnel is live for it. A command
targeting an inaccessible local host does not provide usable access. The executor needs shell
access and the worktree cwd; `--uid` determines the logged-in actor independently of that
executor.

The adapter composes the command, never executes it: it mints no session and holds no
credential. The caller may execute it and share access through the shared records contract;
`@bakers-build/run-outtake` renders supplied access with account, roles and environment. Keep credentials
and session secrets out of durable ticket evidence.

At review reuse the complete actor set and uid-bound commands when still valid. Re-resolve
after reprovisioning, environment/access changes, or a missing persisted uid. Return every
actor as confirmed or unresolved with a reason; a name-bound replacement cannot preserve identity.
