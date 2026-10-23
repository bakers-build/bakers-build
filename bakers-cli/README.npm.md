# @bakers-build/bakers

The bakers.build conductor + client CLI, published as a single self-contained npm
package. Install it globally and run `bakers` anywhere — no repo clone, no local
build (no `pnpm`, no `tsc`).

## Install

```bash
npm install -g @bakers-build/bakers
```

> The unscoped name `bakers` is taken on npm, so the package is scoped `@bakers-build/bakers`.
> The executable stays `bakers` (via the `bin` entry), so every command is just
> `bakers …`.

```bash
bakers --help
```

## What it does

`bakers` is the conductor node and client for a bakers.build network: it registers with a
Drupal control plane, claims tickets over JSON:API, and runs agents through
spawn plugins (Claude, Codex, herdr, and a deterministic fake for tests). Point
it at a control plane with a `conductor.config.js` (scaffold one with
`bakers init`).

## `bakers ui` deep links

`bakers ui` is the interactive terminal cockpit, and it takes an optional target so you open
the thing you are working on directly:

```bash
bakers ui BB-221                  # a ticket by identifier (case-insensitive)
bakers ui project:bakers              # a project; also ticket:<uuid> · run:<uuid>
bakers ui --here                    # this branch's ticket, else this repo's project
bakers ui BB-221 --view teaser    # a compact block instead of the tabbed detail
```

At most **one** target source (the positional, `--ticket`, `--project`, `--run`, `--here`);
two exit non-zero naming both. `--here` reads the current branch for a ticket identifier and
otherwise resolves this repo's git remote against the projects that claim it — several
claimants open a picker. `bakers ui --help` lists every form.

## Plugins

The four spawn plugins ship **inside** this package — nothing extra to install.
Import them from the `@bakers-build/bakers/plugins` entry in your `conductor.config.js`:

```js
import {
  drupalRemote,
  herdrWorkspace,
  claudeAgent,
  herdrExecutor,
} from '@bakers-build/bakers/plugins';
```

Plugin authors can build against the API surface at `@bakers-build/bakers/plugin`.

## Releasing (maintainers)

Publishing is automated: a `v*.*.*` tag publishes `latest`, and every develop
deploy publishes a test build under `next`. Both need an `NPM_TOKEN` CI/CD
variable (masked, protected) with publish rights to the `@bakers-build` scope.

To reproduce the published artifact locally:

```bash
pnpm run prepare:publish   # stage conductor/publish/ + each plugins/*/publish/
pnpm run verify:package    # pack the staged set, install it in a temp dir, smoke-test
```

## License

MIT — see [LICENSE](./LICENSE).
