# Claude.ai connector limits and errors

What the claude.ai connector cannot do, which errors to expect, and how to reconnect. Setup is on
[Connect Claude.ai to bakers.build](/get-started/connector).

## Reconnecting / refreshing

- **Token expired or revoked**: the client must refresh its token or ask you to authorize again.
  If calls keep failing with an authentication error, open **Settings → Connectors**,
  disconnect and reconnect the bakers.build connector to re-run the sign-in/consent flow.
- **Permissions changed on your bakers.build account**: nothing to do — permissions are evaluated on
  every request, so the change applies to the next call without reconnecting.
- **The connector URL changed**: remove the connector and add it again with the new URL from
  [Connect Claude.ai to bakers.build](/get-started/connector). The client registers itself again.

## Permission errors (expected, not a bug)

The connector authenticates you with the one bakers.build `bb:session` scope, exactly like a CLI
sign-in — so bakers.build enforces your own role's permissions and workspace rank on every call, no more
and no less. If your account lacks `create bb_ticket`, a create attempt is rejected by bakers.build with
a readable permission error; Claude will report it as a failure. It does not fall back to creating
anything, and it does not retry as a different identity. Ask a workspace admin to grant the
missing permission if you expect to have it.

**Invalid, expired or revoked tokens get an HTTP 401** from bakers.build itself, like a missing one,
so the client asks you to sign in again. Any valid bakers.build `bb:session` token is accepted,
including one issued to the CLI.

## Limitations

- No shell or filesystem access — the connector cannot infer a branch, read a local checkout, or
  run commands. It works only through the bakers tools that bakers.build serves at `/mcp`.
- No conductor assignment, no working/review/done transitions, no bug tickets. The
  connector's instructions stop at `plan` (feature/chore) by design — see the
  [instructions bundle](/configuration/guides/project-instructions)'s "What this bundle
  deliberately drops" section. **This is an instructions-level policy**: `bakers_ticket_transition`
  allows every move the ticket's workflow and your permissions allow. Nothing in this setup blocks a
  later transition beyond Claude following the instructions and your account's permissions.
- A missing recipe or ticket type term is created only when your workspace rank may create terms;
  otherwise `bakers_ticket_create` fails naming it and a workspace contributor or lead adds it first.
- `bakers_ticket_search` returns at most 50 tickets per call, newest first, with no paging; search
  with a narrower word instead.
