# bb_core

Core bakers.build control-plane entities (ticket, project, conductor, run, …)
and their services.

## Typed ticket links

`bb_ticket.links` is a stock multi-value Drupal `link` field. Each item
carries a **derived kind** so the ticket display can render it as a typed
anchor with an icon.

- **Write plain `{uri, title}`** — the `kind` is *never* authored.
  `BbTicket::preSave()` classifies each link URI with
  `LinkKind::fromUri()` and stores the result in the item's
  `options.bakers.kind`. Existing `options` keys are preserved; re-saving is
  idempotent.
- **Nothing reads the kind for display right now.** `BbTypedLinkFormatter`
  (`bb_typed_link`) used to be wired onto the `bb_ticket` default view
  display and rendered `<a>` + a per-kind inline SVG icon
  (`data-kind="<kind>"`), with missing/unknown kind falling back to `doc`.
  It was deleted together with the SDC `bb_theme:ticket_links` it
  rendered through, because that component is reachable from no Designbook scene
  and the Drupal presentation layer is to be rewired wholesale. The default view
  display now uses core's plain `link` formatter.

  **The classification below is unchanged and still stored on every save**, so
  this is a gap in presentation only — whatever renders typed links next reads
  `options.bakers.kind` exactly as documented here and needs no migration.

| URI contains                              | kind     |
|-------------------------------------------|----------|
| `/-/merge_requests/`                      | `mr`     |
| `/-/pipelines/` or `/-/jobs/`             | `ci`     |
| `/-/tree/`, `/-/commits/`, `/-/branches`  | `branch` |
| `.slack.com/archives/` (a Slack thread)   | `chat`   |
| anything else                             | `doc`    |

**Descoped (product-owner decision):** no live MR/CI/branch **state** is ever
fetched or stored — the icon-by-kind is the deliberate 90%. Live state,
cross-ticket queries, webhooks and cron mirroring are out of scope; revisit
as a separate ticket if wanted.
