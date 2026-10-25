# Claude.ai connector limits and errors

What the claude.ai connector cannot do, which errors to expect, and how to reconnect. Setup is on
[Connect Claude.ai to bakers.build](/daily-work/claude-ai).

## Reconnecting / refreshing

- **Token expired or revoked**: claude.ai refreshes automatically using its stored refresh token.
  If a call starts failing with an authentication error anyway, open **Settings → Connectors**,
  disconnect and reconnect the bakers.build connector to re-run the sign-in/consent flow.
- **Permissions changed on your bakers.build account**: nothing to do — permissions are evaluated on
  every request, so the change applies to the next call without reconnecting.
- **The connector URL changed**: remove the connector and add it again with the new URL from
  [Connect Claude.ai to bakers.build](/daily-work/claude-ai). The client registers itself again.

## Permission errors (expected, not a bug)

The connector authenticates you with the one bakers.build `bb:session` scope, exactly like a CLI
sign-in — so bakers.build enforces your own role's permissions and workspace rank on every call, no more
and no less. If your account lacks `create bb_ticket`, a create attempt is rejected by bakers.build with
a readable permission error; Claude will report it as a failure. It does not fall back to creating
anything, and it does not retry as a different identity. Ask a workspace admin to grant the
missing permission if you expect to have it.

**Invalid, expired or revoked tokens are not a clean 401.** Only a *missing* bearer gets an HTTP
401 from the server. An invalid, expired or revoked token is forwarded to bakers.build; its rejection
comes back inside the conversation as a failing tool call or an empty tool list, not as a
connection-level failure. There is no token audience binding: any valid bakers.build `bb:session`
token, including one issued to another bakers.build client such as the CLI, is accepted. If tools start
erroring unexpectedly, disconnect and reconnect the connector (see below) rather than assuming
it's a permission problem.

## Limitations

- No shell or filesystem access — the connector cannot infer a branch, read a local checkout, or
  run commands. It can only read/write through the four MCP tools (`search`, `read`, `create`, `update`).
- No conductor assignment, no working/review/done transitions, no bug tickets. The
  connector's instructions stop at `plan` (feature/chore) by design — see the
  [instructions bundle](/advanced/configuration/claude-project-instructions)'s "What this bundle deliberately drops" section for the full list and why. **This is an
  instructions-level policy, not a server-enforced one**: the MCP server itself exposes the same
  `update` tool bakers.build's JSON:API would accept from any `bb:session` client, so it would technically
  let a state/conductor write through if asked to make one. Nothing in this setup should be relied
  on to block that beyond Claude following the instructions and your own account's permissions.
- No label/term creation — a missing `work:*`/`method:*` label or ticket type blocks qualification
  until a workspace contributor or lead adds it in the workspace settings, or someone with CLI access
  creates it.
- `search` returns at most 100 results per call with no offset/pagination; narrow with `filters`
  rather than expecting to page through a large result set.
