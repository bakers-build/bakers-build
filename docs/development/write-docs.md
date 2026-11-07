# Write the docs

The public manual is Markdown under `docs/`, rendered by VitePress from `docs/.vitepress/`. It has nine ordered areas, defined in `docs/.vitepress/manual.mjs`:

| Area | Reader task | Folder |
|---|---|---|
| Get started | Execution choice, first setup and basic ticket use | `docs/get-started/` |
| Provision | Worker preparation, environments and hooks | `docs/provision/` |
| Security | Tools strategy, enforced boundaries, credentials and access | `docs/security/` |
| Agents | Harnesses, models, aliases and routing | `docs/agents/` |
| Skills & Workflows | Instructions, recipes, states and approvals | `docs/skills-and-workflows/` |
| Addons | Supported extensions and authoring | `docs/addons/` |
| Configuration | File ownership, precedence, validation and migration | `docs/configuration/` |
| Self-hosting | Application-server deployment, updates and backups | `docs/self-hosting/` |
| Development | Product contributor guides | `docs/development/` |

Explain local versus remote execution before detailed setup. Keep worker preparation separate from application-server hosting. Each area overview states its purpose, relationships and where to begin. Configuration links to the topic that owns behavior.

`docs/index.md` renders at `/manual`, `docs/landing.md` at `/`. `SRC_EXCLUDE` excludes repository operating guidance under `bakers/`, decisions, conductor notes and the internal metrics document. Public contributor guides render under Development.

## Writing

Use English, second person and short sentences. State the reader's task and benefit first; explain or link terms on first use. Task guides need prerequisites, choices before the step that needs them, a working example, a visible success check and a next step. Keep agent prompts and manual CLI alternatives in one guide; disclose longer CLI detail when useful.

Configuration references identify ownership/location, required and optional values, a minimal example and verification. Each addon owns its purpose, setup, configuration (or explicit no-options), example, success check, limitations and source link. Detailed command/options pages can sit beneath the addon. Do not describe support libraries as provisioners, native Node as an addon, or an unimplemented client as available.

Each fact has one canonical home. Repeat only essential safety instructions at the point of action, linking the full reference. Check behavior claims against source/tests; browsing a guide does not prove its setup commands ran.

## Length and navigation

| Page | Prose word limit |
|---|---|
| Manual and area indexes | 250 |
| Setup, daily-work and main addon pages | 400 |
| Provision, Security, Agents, Skills & Workflows, Configuration, Self-hosting and Development detail pages; addon build/subordinate references | 1,500 |

Frontmatter, fenced code, link destinations and HTML do not count. Split by useful topic when a page exceeds its limit. Every rendered manual page needs a sidebar entry. Keep all nine areas directly accessible.

Use logical canonical URLs and update current internal links and anchors. This manual restructure does not preserve old URLs or fragments; do not add migration aliases solely for compatibility. Any retained `docs/routes.json` entries must be direct, valid and free of content-page collisions. Inventory existing content before moving it, and audit each disposition so useful topics remain reachable.

## Checks and publication

```sh
cd docs
pnpm build
node --test scripts/manual.test.mjs scripts/marketplace.test.mjs
```

The build checks page length/navigation, compiles VitePress, validates rendered internal links across landing/nav/sidebar/content/footer, checks redirect pages and target anchors, and generates the plugin marketplace. The regression tests cover valid links and broken navigation/redirect cases.

`docs_pages` runs the page gate and checker/marketplace tests before merge. The merge gate's `docs` image runs the full build; the deployed site describes `develop`, with its revision in the version row. Follow all additional matching gates in root `WORKFLOW.md` when changing checker code, CI, skills or Markdown-consuming tests.

For a scoped diagnostic, use `node scripts/check-pages.mjs <folder>/` or `node scripts/check-site.mjs /<route>/`. Run the complete docs commands before declaring the migration valid.
