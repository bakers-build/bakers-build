// BB-658 Task 3 — MCP service connection config.
//
// No service-account credentials here: in HTTP mode `@dropsh/plugin-mcp`
// forwards each request's own `Authorization: Bearer ...` header downstream
// per-request; a missing bearer stays anonymous. There is no default-profile
// client_credentials identity to configure (BB-658 review F9 — an earlier
// `oauth2_client_credentials` profile/env trio here was dead code).
//
// Entity/operation policy — KNOWN GAP, read before changing:
// @dropsh/plugin-mcp's allowlist is two independent global arrays ANDed
// together (verified: plugins/mcp/src/options.ts `isToolEnabled` at the
// pinned commit) — it cannot express "create allowed for bb_ticket but not
// for bb_comment/bb_project/bb_term". The arrays below are the closest
// safe superset of the BB-658 policy table:
//   bb_ticket/bb_ticket     search, read, create, update   (exact)
//   bb_comment/bb_comment   create, search                 (update NOT blocked here)
//   bb_project/bb_project   search, read                   (create/update NOT blocked here)
//   bb_term/type|recipe|label search                       (create/update NOT blocked here)
// This config layer is defense-in-depth only. The real enforcement boundary
// is the authorizing human's own Drupal permissions and workspace rank under
// the single `bb:session` scope (BB-658 review F7 — a dedicated
// `bb_mcp_connector` scope was reverted: the project's single-scope rule
// stands, and this allowlist plus the project instructions are the actual
// policy ceiling, not an OAuth scope).
const baseUrl = process.env.MCP_BASE_URL;
if (!baseUrl) {
  throw new Error("MCP_BASE_URL is required");
}

export default {
  schema_version: 4,
  site: { base_url: baseUrl, jsonapi_prefix: "/jsonapi" },
  plugins: [
    { plugin: "@dropsh/plugin-jsonapi-schema", export: "jsonapiSchemaPlugin" },
    {
      plugin: "@dropsh/plugin-mcp",
      export: "mcpPlugin",
      with: {
        bundles: [
          "bb_ticket/bb_ticket",
          "bb_comment/bb_comment",
          "bb_project/bb_project",
          "bb_term/type",
          "bb_term/recipe",
          "bb_term/label",
        ],
        operations: ["search", "read", "create", "update"],
      },
    },
  ],
};
