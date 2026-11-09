# Repository conventions

Repository-internal rules for working in the bakers.build repository. `CLAUDE.md` points
here; every entry binds.

## English only

Every document, code comment, skill, user-facing string (`t()`, route titles, config labels, Twig
literals), Designbook story, scene and sample value is English, and so are the tests asserting
them. Translate German content when you touch it.

One exception: the public landing page has a German copy set
(`docs/.vitepress/theme/landing/copy.ts`, served at `/de/`). Only that landing copy may be German;
the docs pages, code, comments and tests stay English.

A product that posts in a configurable language may also ship its user-facing texts translated, each
language next to English in one messages file (the PM bot's `plugins/bot-channels/messages.json` and
`poller/messages.json` under `experimental/pm-bot/`);
its code, comments and docs stay English, and its tests may assert the translated texts.

## Stay as close to standard Drupal as possible

Core/contrib configuration and existing extension points before custom PHP. A listing is a View
owning its route through a Views page display, with contextual filters and presentation in the
View and Display Builder. No custom controller merely to render a View, including on project/team
tab routes. Preserve route context, access checks and navigation when wiring displays.

## An island only for a concrete interaction

Add an island only for an interaction that needs island features: event handling, action links
that rebuild a specific region. A listing, exposed filters or placement on a detail/tab route
never justifies an island, host wiring or a PHP rendering wrapper.

## Config has two homes, never patch a server

Never hand-patch a live server with `drush`. Fix config in both `config/sync/**` and the matching
recipe `config/**`; entity displays, form displays and page layouts live in exactly those two
places and never in a module's `config/install` or `config/optional`. Test the recipe first,
check `config/sync` last at the same revision, and always name the `ddev init` provider
(`WORKFLOW.md` › *provision*). Environment preparation is `node scripts/setup-worktree.mjs`;
explicit `ddev init` reinstalls the selected database. Reuse/bootstrap preserves existing data.
Project-owned QA wrappers require Composer dependencies, not addon installation or repair.

## Designbook owns the theme's artifacts

Components, stories, scenes, entity mappings and design tokens go through the Designbook skills
(`designbook:design-component`, `design-screen`, `design-entity`, `design-shell`, `tokens`), never
by hand. A component styles through `semantic.*`/`component.*` tokens only, never a bare
`primitive.*` reference, hand-CSS, a BEM class or an arbitrary Tailwind value. A component is delivered only if a scene reaches it; adding or
deleting a component directory amends `TARGET_COMPONENT_COUNT` in
`tests/contract/data-display-components.sh` with a paragraph saying why.

## Tests before the merge, not per revision

PHPUnit and the Playwright browser suite run once, in the CI merge gate, before the merge
request is merged (`WORKFLOW.md` › *deliver*), against the images that deploy. Every script
under `tests/contract/` runs in CI, and a script nothing in CI runs is not committed.

## `bakers ui` for a human: playground, herdr tab, always

The committed `.bakers/bakers.config.js` hits remote develop. Run `scripts/setup-test-project.sh`, then
`./bakers-cli/bin/bakers ui --config workspaces/bakers-playground/.bakers/bakers.config.js` inside a tab
from `herdr tab create`. Never piped, never captured frames, never a live tenant.

## bakers CLI

After editing any bakers-CLI source: `cd bakers-cli && pnpm install && pnpm -r run build`.
`bakers-cli/` is a layered acyclic package graph (kernel → surface contract → addons → sinks)
enforced by `bakers-cli/scripts/assert-acyclic.mjs` through a vitest test; `bakers-cli/biome.json` is
the formatter and linter and `pnpm lint` the gate.
