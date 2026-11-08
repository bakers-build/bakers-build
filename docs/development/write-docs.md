# Write the docs

The public manual is Markdown under `docs/`, rendered by VitePress from `docs/.vitepress/`. It has seven ordered sidebar areas, defined in `docs/.vitepress/manual.mjs`:

| Area | Reader task | Folder |
|---|---|---|
| Get started | Create tickets, work on tickets and review results | `docs/get-started/` |
| Provision | Machines, worktree environments, tools, security and examples | `docs/provision/` |
| Agents | Harnesses, models, aliases and routing | `docs/agents/` |
| Skills & Workflows | Instructions, recipes, states and approvals | `docs/skills-and-workflows/` |
| Addons | Supported extensions and authoring | `docs/addons/` |
| Configuration | File ownership, precedence, validation and migration | `docs/configuration/` |
| Self-hosting | Application-server deployment, updates and backups | `docs/self-hosting/` |

Start with ticket tasks. Provision owns machine setup, worktree compatibility, tools and integrations, security, and environment examples. Tools are a general concept; security explains their access boundaries. DDEV, Docker Compose and Node.js are examples, not an exhaustive support list. Keep worker preparation separate from application-server hosting. Give each overview section a short introduction before its links. Configuration links to the topic that owns behavior.

`docs/index.md` renders at `/manual`, `docs/landing.md` at `/`. `SRC_EXCLUDE` excludes repository operating guidance under `bakers/`, internal contributor guides under `development/`, decisions, conductor notes and the internal metrics document. Development stays in the source checkout; it is absent from public navigation, pages, search and sitemap. Public guides must not link to `/development/` routes.

## Writing

Use English, second person and short sentences. State the reader's task and benefit first; explain or link terms on first use. Task guides need prerequisites, choices before the step that needs them, a working example, a visible success check and a next step. Keep agent prompts and manual CLI alternatives in one guide; disclose longer CLI detail when useful.

## Guide reader choices

Show the decision where it matters. Name the reader's situation, the action it leads to and the result. Use the existing elements consistently:

| Element | Use it for |
|---|---|
| `DocTiles` | Separate destinations or reader situations. Each card states who it is for and where it leads. |
| `DocQuickLinks` | Plain lists for task indexes, follow-up tasks and related guides: a linked title, an inline explanation and a trailing arrow. Each item needs `label`, `text` and `link`. Introduce each group briefly and set its `aria-label` to match. |
| Code-group tabs | Variants of the same step, such as installing skills in Claude Code or Codex. |
| Numbered steps | Actions that must happen in order. Give each step a short introduction. |
| Tip or info callout | A skip condition, prerequisite or context needed before continuing. |
| Details block | Optional background or manual alternatives. Keep required prerequisites and safety boundaries visible. |

Tools and security are complementary topics, so do not present them as exclusive choices. Environment cards are examples, not a support matrix. Get started assumes local execution: prepare your project → first ticket. Check missing tools within that guide; keep the execution-location choice and detailed environment setup in Provision. Every optional guide returns to the relevant step. Readers with a team setup can create and follow tickets without local installation.

Use link lists when readers choose another page by task. Keep ordered instructions as steps, comparisons as tables and contextual references inline. A single next step can remain a short link or the page footer; do not duplicate it with another navigation block.

## Keep detail with its owner

Configuration references identify ownership/location, required and optional values, a minimal example and verification. Each addon owns its purpose, setup, configuration (or explicit no-options), example, success check, limitations and source link. Detailed command/options pages can sit beneath the addon. Do not describe support libraries as provisioners, native Node as an addon, or an unimplemented client as available.

Each fact has one canonical home. Repeat only essential safety instructions at the point of action, linking the full reference. Check behavior claims against source/tests; browsing a guide does not prove its setup commands ran.

## Length and navigation

| Page | Prose word limit |
|---|---|
| Manual and area indexes | 250 |
| Setup, daily-work and main addon pages | 400 |
| Provision (including Security), Agents, Skills & Workflows, Configuration and Self-hosting detail pages; addon build/subordinate references | 1,500 |

Frontmatter, fenced code, link destinations and HTML do not count. Split by useful topic when a page exceeds its limit. Every rendered manual page needs a sidebar entry. Keep all seven areas directly accessible in the sidebar. Landing and documentation share `NAV`: How it works, Get started, Documentation and Addons. Documentation groups Provision, Agents, Skills & Workflows, Configuration and Self-hosting.

Use logical canonical URLs and update current internal links and anchors. Backward-compatible URLs, fragment aliases and new redirects are not required. All retained `docs/routes.json` entries must be direct, valid and free of content-page collisions. Inventory existing content before moving it, and audit each disposition so useful topics remain reachable.

## Checks and publication

```sh
cd docs
pnpm build
node --test scripts/manual.test.mjs scripts/marketplace.test.mjs
```

The build checks page length/navigation, compiles VitePress, validates rendered internal links across landing/nav/sidebar/content/footer, checks redirect pages and target anchors, and generates the plugin marketplace. The regression tests cover valid links and broken navigation/redirect cases.

`docs_pages` runs the page gate and checker/marketplace tests before merge. The merge gate's `docs` image runs the full build; the deployed site describes `develop`, with its revision in the version row. Follow all additional matching gates in root `WORKFLOW.md` when changing checker code, CI, skills or Markdown-consuming tests.

For a scoped diagnostic, use `node scripts/check-pages.mjs <folder>/` or `node scripts/check-site.mjs /<route>/`. Run the complete docs commands before declaring the migration valid.
