# Client guide: ownership and evidence

Date: 2026-11-08. Scope: BAKERS-125. **Incomplete: the four real client captures and rendered/human review are still required.** This maintainer record is excluded from the public manual by `SRC_EXCLUDE`; it is not another setup guide.

The approved scope is the ticket's spec `b483cd38-9def-4263-9d6b-b09967466a22`, plan `c30e5537-2e70-48e0-83b0-7270d02ea8a5` and test `e3a74095-4e09-4d11-be7f-8143cfe30dda`, confirmed by `d7c34701-cecb-48b1-bf86-8410b2d53797`. Execution results and the final immutable revision belong in the typed coding handoff on the ticket.

## Page map

| Path | Disposition and reason |
|---|---|
| `docs/get-started/use-your-client.md` | Created: one usage guide, four client sections, comparison and first actions. Owns the client concept. Real illustrations remain outstanding. |
| `docs/configuration/clients.md` | Removed after merging usage into the new guide. Technical selection stays in `docs/addons/slots.md`; verification stays in addon references and the first-ticket guide. |
| `docs/configuration/clients/{cli,tools,auth,switch-to-bakers,troubleshooting}.md` | Kept unchanged as CLI references; their parent directory remains. |
| `docs/.vitepress/manual.mjs` | Use your client follows Get started Overview. Configuration's old Clients group becomes CLI reference, retaining every child. Seven public areas remain after the confirmed Development amendment below. |
| `docs/get-started/{index,connect-a-project,first-ticket}.md` | Kept: link to usage, distinguish client views from execution setup, include herdr-app. Existing `connect-a-project#choose-your-tui` anchor remains. |
| `docs/agents/guide.md` | Kept: executor hosts sessions; clients expose views and actions. |
| `docs/configuration/index.md`, `docs/index.md` | Kept: link usage to its new owner, keep CLI settings separate, name Hermes consistently. No landing layout change. |
| `docs/addons/{herdr,herdr-core,orca}.md` | Kept as setup owners with specific usage backlinks. Corrected detached conductor startup; removed unverified Orca diff/browser/mobile promises. |
| `docs/addons/{herdr,herdr-core,orca}/options.md`, `docs/addons/workspace-git.md` | Kept unchanged as detailed technical references. No settings duplicated in usage. |
| `docs/addons/{slots,catalog}.md` | Kept: link usage and distinguish herdr-app from its herdr-core integration. |
| `README.md` in `bakers-build/hermes-bot` | Kept: Hermes architecture/usage and MCP limits; added public usage backlink. Its Coder setup link remains. |
| `coder/bakers-ddev/README.md` | Kept: `#pm-bot` owns operator setup, with usage backlinks. Coder is an optional worker environment. The unverified public workspace-image prerequisite remains. |
| `docs/provision/coder-workspace.md`, connector and `bakers-ui` guides | Kept unchanged as supporting environment/access/cockpit guidance. |
| `docs/routes.json` | Adds the four direct legacy mappings below, using the existing redirect renderer. |
| `docs/decisions/brand-foundation.md`, `web/themes/custom/bb_theme/designbook/vision.yml` | Added the agreed provisional slogan/metaphor to its canonical owner and a relative reference from vision. Earlier slogan candidates are explicitly historical. |
| `docs/public/clients/{herdr-cli,herdr-app,orca,hermes}.png` | Planned, **absent**. Do not add broken image links, synthetic frames or invented captures. |
| `docs/decisions/client-guide.md` | This excluded page map, source evidence and capture record. |

### Confirmed amendment: internal Development

On 2026-11-08 the requester reviewed the preview and asked to keep Development internal and include the change in this PR (ticket comment `f02948f2-cade-43c0-9c80-8385d0d2c490`). This replaces the plan's eight-area preservation and extends its scope to this publication boundary. `docs/development/**` remains repository documentation, excluded from the public build, navigation, search and sitemap. Public guide links are removed or redirected to the relevant public user guide; no `/development/` redirect publishes the internal content elsewhere. The existing page gate and navigation fixtures now require seven areas and reject links to excluded pages. Internal documentation content is retained, with repository-relative navigation.

The existing docs tunnel became available after the requester started the preview outside the agent sandbox. Their “otherwise it fits” is favorable feedback on the displayed docs; it does not supply the missing four genuine client captures or their runtime evidence.

| Old URL | Direct destination |
|---|---|
| `/configuration/clients` | `/get-started/use-your-client` |
| `/configuration/clients#clients` | `/get-started/use-your-client` |
| `/configuration/clients#ownership-and-selection` | `/addons/slots` |
| `/configuration/clients#verify` | `/get-started/first-ticket` |

The bot/Coder README backlinks use the public guide URL, which becomes available when deployed. The guide's GitHub `next` link remains the canonical bot setup reference; a branch preview must inspect the changed README as well because its backlink is not on `next` yet.

## Capability evidence

Source inspected at `b89398b187bf51f4f9ca5bfc1150469f73a879e6` (the implementation base, after a fast-forward from the plan's `f032e08e4c7235d3f5e10983f946e161654d26cb`). Listed source/test files are unchanged between those revisions. **Tests inspected are not tests executed.** Wiring evidence does not establish external app UI behavior.

| Guide claim | Current source and relevant tests | Limit of evidence |
|---|---|---|
| herdr-cli workspaces, overview and labelled interactive run tabs | `bakers-cli/addons/herdr/src/{index,preset,open-layout,config}.ts`; `tests/{executor,open-workspace}.test.ts`. `startRun` creates the terminal/tab with identifier, state and run ID; default overview runs `bakers ui --ticket`. | Layout can be overridden, including `open: {}`. Actual terminal interaction and screenshot still need a demo observation. |
| herdr's frozen marker is presentation only | `bakers-cli/addons/herdr/src/frozen-marker.ts`; `tests/frozen-marker.test.ts`. | The marker does not pause a process itself. The guide does not promise that it does. |
| herdr-app uses herdr-core, a separate host from herdr-cli | `bakers-cli/addons/herdr-core/src/{index,preset}.ts`; `tests/executor.test.ts`: persistent executor, no workspace layout; detached `hc run --bg --no-parent --outlive-parent` with ticket/branch/run labels. | `hc >=0.1.18`; workspace supplied separately. App presentation/controls and close/reopen behavior were not observed. No shared-host or UI-control promise. |
| herdr-core run terminals disappear after finalization | Same executor's `cleanupRun` locates one run by branch/run labels, kills live matches and removes them; cleanup tests cover sibling isolation and best-effort failure handling. | Cleanup is best effort. The guide sends readers to the ticket summary for the lasting outcome. |
| Orca adopts ticket worktrees and hosts overview/run terminals | `bakers-cli/addons/orca/src/{index,workspace,orca-cli,preset}.ts`; `tests/{executor,workspace}.test.ts`: runtime readiness, repo registration/adoption, run-title preservation, overview creation and cleanup. | Current setup reference requires Orca 1.4+, a running runtime and the same machine/user. No live diff/browser/mobile behavior has been verified or advertised by this change. |
| Hermes opens public request channels, qualifies requests, posts progress and relays answers | `{README.md,SOUL.template.md}` in `bakers-build/hermes-bot`, `plugins/bot-channels/`, `poller/`; `poller/{poller,questions}.test.mjs` and `plugins/bot-channels/test_channels.py` cover state posts, channel membership and question protocol. | Only the main channel and its own open request channels are served. Conversation quality and an actual Slack exchange remain unobserved. |
| Hermes uses a service account/MCP and has no execution or project-editing tools | `config.template.yaml` in `bakers-build/hermes-bot` restricts toolsets to the bot's tools and read-only clone MCP; `lib/bakers-client.test.mjs` checks the bearer API key and MCP calls. `Dockerfile` pins Hermes v0.22.5 by digest. | The configured service account's project membership/rights define access. No dedicated Bakers addon; operator setup is the Coder README's `#pm-bot`. |
| Ordinary conductor startup is detached and requires no herdr process host | `bakers-cli/conductor/src/process/detached-spawn.ts`; `bakers-cli/conductor/tests/cli/bakers.test.ts`, “starts without any process host or herdr addon configured”. | This corrects the old herdr-core setup paragraph; no runtime change. |
| One configured executor determines where runs start | `docs/addons/slots.md`, the addon presets above, `bakers-cli/conductor/src/config.ts` and `tests/config-addon-scopes.test.ts`. | Machine executor overrides project executor, then discovered addons. Client choice is not a per-ticket executor switch. |

## Capture status and recapture paths

Local read-only probes on 2026-11-08: `herdr --version` → 0.9.5; `hc --version` → 0.1.18; `orca --version` → 1.4.242. `DISPLAY` and `WAYLAND_DISPLAY` are unset. `orca status --json` reports a reachable ready headless runtime, `desktopWindowStatus: blocked`, and `browser_unavailable` (no browser backend). A running headless runtime is not a screenshot of the app. No client was installed, configured, launched or switched for captures.

| Required asset | Status / missing access | Recapture path once available |
|---|---|---|
| `herdr-cli.png` | Missing: permitted demo project/session and a real terminal capture surface. Binary presence only was checked. | In the actual terminal, open a demo ticket worktree, inspect its overview and labelled run tab, observe output and interaction, then capture. If showing `bakers ui`, use the playground connection. |
| `herdr-app.png` | Missing: actual app access, app version and permitted `hc` demo run. | Correlate the ticket/run labels in `hc ls` with the app terminal, follow output, observe only the interaction described, then capture the app. Do not substitute CLI output. |
| `orca.png` | Missing: permitted demo worktree/run and accessible app surface. Existing runtime is headless with its desktop blocked. | In the actual personal runtime, open the adopted demo worktree and agent terminal, observe output/response, then capture that surface. |
| `hermes.png` | Missing: configured demo bot, permitted Slack requester/channel and capture surface. | Follow the PM-bot → Coder setup references in an existing demo environment. Observe a ticket-linked request/status or question/answer exchange and capture Slack. A fresh exchange requires authorization for the participants/channel. |

For each real capture, record the asset path, date, client version (app and `hc` separately; bot image digest/Hermes version), Bakers commit, OS/surface, viewport/pixel dimensions, demo ticket/run, observed action/limit and privacy inspection. Exclude credentials and customer identities at capture time. Write meaningful alt text and a visible caption from the observed screen, link full size, then inspect all four at desktop and 390 CSS pixels. No capture metadata can be filled from assumed versions or generated images.

## Verification and handoff boundaries

The confirmed public entry seam was checked before editing: “Use your client” was absent after Overview. After editing, the same one-off navigation assertion passed. Existing docs build/regression tests own navigation, budgets and redirect integrity. They do **not** prove image presence, readability, external links or client behavior. Final project, functional and human results are recorded individually in the ticket's coding handoff; missing captures keep AC-4 and the overall GREEN gate unmet.

The required `provision_up('docs-preview')` call was rejected: `profile: must be equal to one of the allowed values`. No preview was started or shared. `provision_up('deps')` succeeded for the independent project checks. The worktree's DDEV project is stopped; rendered navigation/image review awaits the supported preview profile and browser environment. A build alone does not clear that blocker.

- **BAKERS-125:** owns the client concept, guide, four genuine captures/provenance, client-related source corrections, navigation/backlinks/redirects and brand carry-forward. This partial implementation does not release the downstream prerequisite.
- **BAKERS-121:** later audits remaining Getting Started/Daily Work. Inherit this entry and link to it; do not rebuild the comparison or reopen the four-client choice.
- **BAKERS-122:** later audits remaining Configuration/Operations, including CLI and Coder details outside these corrections. Usage leaves Configuration; settings retain their canonical owners.
- **BAKERS-123:** later audits remaining addon documentation. Keep herdr/herdr-core references separate and preserve usage backlinks. Do not create a Hermes addon or duplicate the comparison.
- **BAKERS-124:** independent.

No downstream audit, runtime feature, shared client reconfiguration or outside-worktree recovery of the intake's local brand files is part of this change.
