# bakers.build Addon

Addon definitions run by conductors and the ticket's inline addons card. The
module is the responsible
[inbox](../bb_inbox/README.md) handler for every `<addon>.<key>`
message id (contract 2: one addon registers `messages`, each message's
handler returns exactly `{ markdown }`). Contract 1 (`actions`,
views/row-actions/refresh-cadence addon UI, `bb_addon_state`) is retired;
registrations against it are rejected and their rows removed.

## Entities

- `bb_addon`: `name`, `version`, `contract`, `definition` (JSON, immutable,
  optionally carrying an inline SVG `icon`; a new icon needs a new version),
  `conductors` (who runs this version). One row per `(workspace, name,
  version)`; the first stored definition wins and a differing one is ignored.
  A conductor resolves the row it is listed on. Entity
  access is `administer bakers` only; product readers go through
  `AddonRepository` and check ticket or conductor access themselves.

## Contract

`schemas/addon-definition.v2.schema.json` is the addon envelope (`name`,
`version`, `contract`, `label`, the `messages` map). `AddonContractValidator`
checks it on register and delegates each message to the inbox's
`MessageContractValidator` (errors under `messages.<key>.`); the message
schemas and the payload and result validation live in
[bb_inbox](../bb_inbox/README.md). `AddonInboxSubscriber` and
`AddonMessageForm` validate a payload against its message's `input` with that
validator. A contract-1 registration is rejected by its `contract`
value alone (`AddonsRegisterResource::register()`); the `v1` schemas and
their PHP validation methods are retired along with it.

## Resources

| Route | Who | What |
|---|---|---|
| `POST /jsonapi/bakers/addons` | conductor owner | `{conductor_id, addons}`; per addon accepted (UUID) or rejected (reason); 422 when all were rejected |
| `GET /jsonapi/bakers/addons/ticket/{ticket}` | ticket viewer | the read model `bakers ui` renders |

## The ticket addons card

`BbTicketAddonsSource` (UI Patterns source `bb_ticket_addons`) renders a
card inline in the ticket detail's right column whenever the ticket's
conductor runs at least one addon — no overlay, no dialog, no button to open
it, and no "Addons" wording in the rendered UI. `TicketAddonsController` builds
the card: a tab per addon (its `label`) when there is more than one, and the
`addon_panel` island (`AddonsIslandHost`, host `ticket_addons`) for the
selected addon. The panel is rendered by `AddonMessagePanelRenderer`: each
message of that addon as a single button, or a Form API form built by
`AddonMessageForm` when the message declares `input`, plus the requester's own
newest answer for that addon rendered as Markdown below the forms. Messages
the viewer lacks the ticket operation for are not rendered. A person with no
request of their own sees "You have not sent a message to this addon." below
the forms, never another person's answer. While a
message of the shown addon is pending or running the panel re-fetches itself
every 3 seconds (a tab switch re-fetches the whole card as a fragment, via
`core/drupal.htmx`, and swaps it in place). An offline conductor greys the
messages out.

## The addon overview

Workspace **Settings › Addons** (`view.addons.settings`,
`/{workspace}/settings/addons`) is the third tab after Settings and Members.
Like Members it is for workspace leads only: `BbWorkspaceRouteSubscriber`
gives every Views route under `/settings/` the `bb_workspace.update` gate. The
page is read-only and has no rail entry.

It lists every registered addon **once**, sorted by name. The `newest_per_name`
Views filter (`AddonNewestPerName`, registered by `BbAddonViewsData`) keeps
the newest row of each name, by `created` and then `id`. That row supplies the
icon, the label and the contract.

Two formatters render the rows:

- `bb_addon_definition` shows one part of the definition: `label`, `icon` or
  `versions`.
  - `versions` lists every version of the name once, newest first.
  - The icon is only ever shown as a base64 `data:` URI in the `person` mark's
    `<img>`, never printed as markup.
- `bb_addon_conductors` shows one badge per conductor and version, as
  `<conductor> <version>`, across every version of the name. A conductor appears
  only when an access-checked query returns it **and** its project belongs to
  the routed workspace, so a conductor the viewer owns in another workspace
  stays off the page.

Both formatters read the sibling rows through `AddonRepository::rowsOf()`. The
conductor badges and the `versions` part carry the `bb_addon_list` cache tag,
so a newly registered version updates the row.
