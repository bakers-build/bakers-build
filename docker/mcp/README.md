# MCP service image (BB-658 Task 3)

Hosts the upstream `@dropsh/plugin-mcp` Streamable HTTP server for Claude's
MCP connector, pinned at dropsh commit `ae67d761995fc63239de6da8e7ab985e2545c379`.

## Why this needs two processes in one container

Verified against the plugin's actual source at the pinned commit
(`plugins/mcp/src/transports.ts` in the `dropsh` repo):

- `startMcpHttpServer` calls `server.listen(port, "127.0.0.1", ...)` — the
  bind address is a hardcoded literal. There is no flag or env var to bind
  `0.0.0.0` (checked `src/index.ts`, `src/options.ts`, `src/transports.ts`;
  the only CLI flags are `--stdio` / `--http <port>`).
- `handleHttp` additionally rejects any request whose `Host` header isn't
  exactly `127.0.0.1:<port>`, and any `Origin` header that doesn't match
  `http://127.0.0.1:<port>`.

A process bound to `127.0.0.1` is only reachable from the same network
namespace — i.e. another process in the *same container*, not a sibling
container on the same Docker network (each container has its own loopback).
So `nginx` runs inside this image too, terminating the real ingress route and
reverse-proxying to `127.0.0.1:8787` with `Host` rewritten to the literal the
plugin demands. See `entrypoint.sh` (plain shell + `wait`, no supervisor —
nothing in this repo's other images uses one) and `nginx.conf`.

## Known gap: entity/operation matrix enforcement

The BB-658 policy is:

| Entity/bundle | Permitted operations |
|---|---|
| bb_ticket/bb_ticket | search, read, create, update |
| bb_comment/bb_comment | create, search |
| bb_project/bb_project | search, read |
| bb_term/type, bb_term/recipe, bb_term/label | search |

`@dropsh/plugin-mcp`'s config (`src/options.ts`) only supports two
independent global arrays, `bundles` and `operations`, ANDed together
(`isToolEnabled`). There is no per-bundle operation set and no wildcard. The
closest safe superset is `operations: [search, read, create, update]` ×
`bundles` restricted to the rows above — which means the dropsh-config
layer does **not** block:

- `bb_comment update`
- `bb_project create` / `bb_project update`
- `bb_term create` / `bb_term update` (all three term bundles)

This config layer is defense-in-depth only. **The real enforcement boundary
is the authorizing human's own Drupal permissions and workspace rank**, under
the single `bb:session` scope every bakers.build client authenticates with (BB-658
review F7: a dedicated `bb_mcp_connector` scope was reverted — this project
keeps exactly one OAuth scope). The connector never gets more than the
signed-in user's own role already grants; it never gets less, either, so
`bb_comment update` or `bb_project create` above are only actually
blocked for a user whose role lacks them — there is no connector-specific
ceiling beyond this allowlist and the project instructions. Exercised by
`web/modules/custom/bb_core/tests/src/Kernel/OauthClaudeConnectorAccessTest.php`
(the rank/permission boundary, mocked token).

A missing bearer on `/mcp` gets a clean HTTP 401 (`nginx.conf`); an invalid,
expired, revoked or wrong-audience bearer does not — it is forwarded, and
Drupal's own 401 surfaces as an ordinary JSON-RPC tool error over HTTP 200.
There is no token audience binding. Accepted as-is (BB-658 review N2); see
`docs/daily-work/claude-ai.md`.

Term search uses the entity-wide `view bb_term` permission: every term bundle
(`type`, `recipe`, `label`) is ordinary ticket vocabulary.

`search` has no offset/pagination — only `limit` (≤ 100, default 25). The
project instructions tell Claude to narrow with `filters` rather than expect
to page through a large result set.
