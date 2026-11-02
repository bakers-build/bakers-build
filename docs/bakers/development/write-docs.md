# Write the docs

The public manual is Markdown under `docs/`, rendered by VitePress from `website/`. It has exactly three areas, defined in `website/.vitepress/manual.mjs`:

| Area | Reader task | Folder |
|---|---|---|
| Getting Started | Connector, machine, project, first ticket and daily work | `docs/get-started/` |
| Configuration | Change settings and operate an existing setup | `docs/configuration/` |
| Addons | Set up supported extensions | `docs/addons/` |

The landing page offers three situations: chat-only access, a first machine/project, and another project on a prepared machine. Personas belong in that entry copy, not manual categories. Security is directly under Configuration; agent execution settings belong beneath Agents.

`docs/index.md` renders at `/manual`, `docs/landing.md` at `/`. `SRC_EXCLUDE` excludes repository guidance under `bakers/`, decisions, conductor notes and the internal metrics document. Keep contributor architecture/testing/build instructions here, with useful public bridges where old URLs need them.

## Writing

Use English, second person and short sentences. State the reader's task and benefit first; explain or link terms on first use. Task guides need prerequisites, choices before the step that needs them, a working example, a visible success check and a next step. Keep agent prompts and manual CLI alternatives in one guide; disclose longer CLI detail when useful.

Configuration references identify ownership/location, required and optional values, a minimal example and verification. Each addon owns its purpose, setup, configuration (or explicit no-options), example, success check, limitations and source link. Detailed command/options pages can sit beneath the addon. Do not describe support libraries as provisioners, native Node as an addon, or an unimplemented client as available.

Each fact has one canonical home. Repeat only essential safety instructions at the point of action, linking the full reference. Check behavior claims against source/tests; browsing a guide does not prove its setup commands ran.

## Length and navigation

| Page | Prose word limit |
|---|---|
| Manual and area indexes | 250 |
| Setup, daily-work and main addon pages | 400 |
| Configuration, addon build guides and subordinate detailed addon references | 1,500 |

Frontmatter, fenced code, link destinations and HTML do not count. Split by useful topic when a page exceeds its limit. Every rendered manual page needs a sidebar entry. Keep all eight Configuration topic groups as siblings.

A moved page keeps a one-hop alias in `website/routes.json`. Internal links use canonical destinations. Preserve meaningful old fragments with explicit anchors or fragment targets. Before moving content, save the source/route inventory and audit every disposition so missing redirects cannot disappear from the checker's input.

## Checks and publication

```sh
cd website
pnpm build
node --test scripts/manual.test.mjs scripts/marketplace.test.mjs
```

The build checks page length/navigation, compiles VitePress, validates rendered internal links across landing/nav/sidebar/content/footer, checks redirect pages and target anchors, and generates the plugin marketplace. The regression tests cover valid links and broken navigation/redirect cases.

`docs_pages` runs the page gate and checker/marketplace tests before merge. The merge gate's `docs` image runs the full build; the deployed site describes `develop`, with its revision in the version row. Follow all additional matching gates in root `WORKFLOW.md` when changing checker code, CI, skills or Markdown-consuming tests.

For a scoped diagnostic, use `node scripts/check-pages.mjs <folder>/` or `node scripts/check-site.mjs /<route>/`. Run the complete docs commands before declaring the migration valid.
