# Licensing and publication rights

This page records what each distribution of bakers.build contains, who owns it, its license and the evidence for
that, and whether it is cleared for publication. It reflects develop `f3a00169` plus this branch on 2026-11-02.
Recheck it at the exact revision of any publication candidate. Unresolved rights stay listed under *Blockers*; they
are never cleared by a green check.

## Decisions

The owner, keytec GmbH, confirmed these on 2026-11-02. The confirming user is authorized to state keytec's rights.

| Component | License | Text |
|---|---|---|
| Server: `web/modules/custom/`, `web/themes/custom/` (excluding third-party assets listed below), `recipes/`, `config/`, `patches/`, scripts and tests | GPL-2.0-or-later | [`LICENSE.txt`](../../LICENSE.txt), `composer.json` |
| CLI: every `@bakers-build/*` package under `bakers-cli/` | MIT | [`bakers-cli/LICENSE`](../../bakers-cli/LICENSE); a package's own `LICENSE`/`NOTICE` takes precedence |
| `bakers` plugin skills: `.claude/skills/bakers-build/` | MIT | `.claude/skills/bakers-build/LICENSE` |
| Project skills adopted from keytec: `.claude/skills/testing/`, `.claude/skills/drupal-developer/`, `.claude/skills/drupal-update/` | MIT, © keytec | keytec's grant of 2026-11-02, recorded in [development skills](development-skills.md); not part of the plugin zip |

The license covers copyright only. The bakers.build name and logo are keytec brand marks, and no trademark license is
granted. Third-party material keeps its own license, and its notices stay where they are.

Earlier statements of "MIT" for the whole product (the README badge, `docs/decisions/brand-foundation.md`) and
the `UNLICENSED` declarations in eleven CLI manifests were corrected to the table above.

The earlier in-house classification of all theme icons is disputed by matching upstream shapes. It does not
clear those assets; source confirmation remains open under B3.

## Third-party material that is redistributed

| Material | Where | Source | License | Notice kept in |
|---|---|---|---|---|
| Source Sans 3, IBM Plex Sans, Public Sans, Atkinson Hyperlegible Next (WOFF2) | `web/themes/custom/bb_theme/css/fonts/` | `@fontsource-variable/*@5.3.0` | SIL OFL 1.1 | `*.LICENSE` beside each font, `README.md` |
| Unicode EastAsianWidth 17.0.0 and the width table generated from it | `bakers-cli/addons/bakers-ui/data/`, `src/lib/width-table.ts` | unicode.org UCD | Unicode License V3 | data-file header; `bakers-cli/addons/bakers-ui/NOTICE` (shipped in the npm package) |
| Role portraits for a design mock | `.impeccable/mocks/directions/portraits/` | Unsplash, photo URLs in `CREDITS.md` | Unsplash License (not open source; not relicensed) | `CREDITS.md` |
| Drupal core, contrib and PHP libraries | `vendor/`, `web/core`, `web/modules/contrib` (installed by Composer, not tracked) | `composer.lock` | GPL-2.0-or-later/GPL-2.0+ (47), MIT (98), BSD (13), Apache-2.0 (4), dual BSD/GPL (2) | each package's own files under `vendor/`/`web/` |
| CLI runtime dependencies | installed by npm with the `@bakers-build/*` packages, not bundled | each package's registry tarball | MIT/ISC; `dropsh` and `@dropsh/plugin-*` dual MIT OR GPL-2.0-or-later (keytec; the plugins' manifests lack a `license` field but ship the dual-license `LICENSE`) | each dependency's own tarball |
| Docs site JavaScript (Vue, VitePress, Mermaid and their dependencies, 61 packages) | bundled into `docs/.vitepress/dist` | `docs/pnpm-lock.yaml` | MIT (36, plus `khroma`, whose manifest lacks the field but whose LICENSE is MIT), ISC (18), BSD-3-Clause (5), MPL-2.0 OR Apache-2.0 (DOMPurify) | `/THIRD-PARTY-LICENSES.txt` on the site, generated from the packages in the client bundle |
| 37 tracked DDEV-generated development files | `.ddev/`; excluded from application images | [DDEV](https://github.com/ddev/ddev), generation markers; exact file inventory in `.ddev/NOTICE.DDEV` | [Apache-2.0](https://github.com/ddev/ddev/blob/main/LICENSE) | `.ddev/LICENSE.DDEV`, `.ddev/NOTICE.DDEV`, retained original headers |
| Theme JavaScript and generated CSS | `web/themes/custom/bb_theme/dist/` in both application images | alpinejs and @alpinejs/persist 3.17.3 (pre-bundling @vue/reactivity and @vue/shared 3.5.41), @github/markdown-toolbar-element 2.2.3, chart.js 4.5.1 with @kurkle/color 0.3.4, tailwindcss 4.3.0 (theme lockfile) | MIT | `dist/THIRD-PARTY-LICENSES.txt`, written by the shared Vite plugin (`docs/scripts/third-party.mjs`); Alpine and Vue texts in `js/alpine.NOTICE`. A production theme build on 2026-11-02 lists all of them plus the icon and four OFL font notices |
| Theme SVG icons and generated sprite | `bb_theme/assets/icons/src/`, `dist/icons/sprite.svg` | Feather/Lucide matches recorded in `assets/icons/NOTICE`; remaining provenance, including `google.svg`, unconfirmed | Feather MIT / Lucide ISC texts retained; unknown origins remain blocked | `assets/icons/NOTICE`, included by the theme notice generator; B3 |
| The `bb-verdict` skill, derived from the ponytail skill collection | `.claude/skills/bakers-build/skills/bb-verdict/SKILL.md` | ponytail by Dietrich Gebert (github.com/DietrichGebert), LICENSE identical in 5.3.2 and 5.3.3 | MIT, © 2026 DietrichGebert | `.claude/skills/bakers-build/NOTICE`, shipped in the plugin zip |

The docs site ships no font files. Bricolage Grotesque, Spline Sans and Spline Sans Mono load from Google Fonts at runtime and are not redistributed. The theme
imports `vitepress/theme-without-fonts`, so VitePress's bundled Inter (SIL OFL 1.1) stays out of `dist`, and
`check-site.mjs` fails the build on any font file there.

The phpcs/phpmd/phpstan DDEV wrappers come from keytec's own keytec-ddev-addon. keytec owns that addon, and the
owner permitted adopting these three wrappers, each of which keeps its provenance line.

Own assets with no third-party part: the logos and brand files (`docs/assets/`, `docs/public/`,
`bb_theme/assets/brand/`, `bb_core/assets/email/`), `bakers-design/`, Designbook references rendered from the project's
own Storybook/Figma, the synthetic Playwright fixtures, and the measure profiles in `bakers-cli/addons/claude/measure/`
(settings that name plugins and carry none of their content).

## Surfaces

| Surface | Built from | Status | Evidence |
|---|---|---|---|
| npm: 32 `@bakers-build/*` packages (`TARGETS` in `bakers-cli/scripts/prepare-publish.mjs`) | `dist/src` + manifest + `LICENSE` + `NOTICE` per package | cleared | staging copies each package's declared license and refuses `UNLICENSED`, a missing declaration, or a non-MIT one without its own `LICENSE` (`core/tests/packaging/publish-staging.test.ts`); `pnpm run verify:package` checks the installed license field, `LICENSE` and `NOTICE` of every package |
| `bakers` plugin zip (`plugins/bakers-<version>.zip` on the docs site) | everything under `.claude/skills/bakers-build/` | cleared | `docs/scripts/marketplace.test.mjs` builds the real zip and requires the MIT `LICENSE`, the ponytail notice in `NOTICE`, and exactly the files `git ls-files` tracks under the plugin |
| Docs site | `docs/` (minus `decisions/`, `bakers/`, `conductor/`), the plugin zip | cleared | docs prose is keytec's own. Minification strips most license headers, so `docs/scripts/third-party.mjs` writes `/THIRD-PARTY-LICENSES.txt` with every bundled package's license text (or its README License section). `check-site.mjs` fails the build when the file is missing, a package has no license text, or `dist` holds a font file |
| Application images (`php`, `nginx`) | `COPY .` of the repository minus `.dockerignore`, Composer `vendor/`, theme `dist/` | **not cleared** | built locally at this branch on 2026-11-02 (`docker build --target php` and `--target nginx`, not pushed): both carry `bb_theme/dist/THIRD-PARTY-LICENSES.txt`, `LICENSE.txt` and the icon NOTICE. Blocked only by icon provenance (B3). `.impeccable/` and `.ddev/` are excluded; Composer package notices remain in their own directories |
| Source repository (e.g. a public mirror) | every tracked file | **blocked** | see *Blockers* |

## Development skills

Three of keytec's former private skills are adopted into the repository as the project skills listed under
*Decisions*, MIT per keytec's grant. They are part of the source
repository only, not of the npm packages or the plugin zip. Their source evidence and the public upstream
skills used during development are recorded in [development skills](development-skills.md). No other keytec
skill content is in the repository.

## Blockers

| # | Material | Blocks | Why | Owner action |
|---|---|---|---|---|
| B1 | 7 moodboard images, `.impeccable/mocks/moodboard/refs/*.jpg`: 6 screenshots of third-party sites (graza, monday, raus, typesafe) and `teig-terminal.jpg`, whose origin is unrecorded | source repository | no license or permission from the site owners | remove them from the published tree, or obtain permission (Git history keeps them; rewriting it is a separate decision) |
| B3 | Theme icons, including `google.svg` and shapes with unconfirmed source | source repository and application images | blanket in-house attribution conflicts with upstream matches; notices alone do not establish provenance for unmatched shapes | confirm each source/license or authorize replacement; no inferred Icons8 attribution or permission from resemblance |

The source repository and application images are not cleared. Existing npm/plugin/docs findings remain scoped to
their recorded revisions; recheck changed artifacts before any publication. This document does not authorize publication.

Former blocker B2 (missing DDEV license text) is addressed by `.ddev/LICENSE.DDEV` and the 37-file
inventory in `.ddev/NOTICE.DDEV`; no generated file or original attribution was deleted. These files must
be included in the eventual source publication. Former blocker B4 (unverified image contents) is addressed by the local image builds recorded above. B1 and B3 remain unresolved.
