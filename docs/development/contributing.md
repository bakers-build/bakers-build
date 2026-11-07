# Development

Prepare a checkout to change bakers.build, run the checks that fit your change, and keep the manual in step with the code.

**You need:** repository access; Node 20.19 or later and pnpm for the CLI; DDEV for Drupal work.

1. Read [`WORKFLOW.md`](https://github.com/bakers-build/bakers-build/blob/main/WORKFLOW.md) in full, and the repository conventions `CLAUDE.md` points to. `WORKFLOW.md` invokes `bb-workflow` and holds the phase hints: the runtime, the extra skills and the checks by area under `## bb-phase-validate`.
2. Build the CLI if your change touches `bakers-cli/`.

   ```sh
   cd bakers-cli && pnpm install && pnpm -r run build
   ```

3. For Drupal work, prepare identity with `node scripts/setup-worktree.mjs`, then explicitly
   provision a disposable site with `ddev init --provider recipe-test`. Initialization reinstalls
   that local database. Worktree setup itself leaves DDEV stopped. The project owns these scripts
   and its three QA wrappers; no keytec DDEV addon or keytec-ai configuration tool is needed.
   See the repository's `docs/bakers/testing.md` for environment-file and reuse rules.
4. Make the change, run the checks for it, and update the page of the manual that owns the behavior.

**Done when:** the checks for your areas pass and every manual page that describes changed behavior is updated.

::: tip Ask your AI
"Prepare this checkout for contributing and name the checks my change needs."
:::

## Where things live

| Path | Holds |
|---|---|
| `bakers-cli/` | The CLI: `core`, `conductor`, `ui`, `host` and `addons/*` |
| `web/modules/custom/` | The Drupal modules, `bb_core` being the control plane |
| `web/themes/custom/bb_theme/` | The theme, its components, stories and scenes |
| `recipes/` and `config/sync/` | The two homes of Drupal configuration |
| `tests/` | `contract/` shell checks, `playwright/` browser scenarios, `config-sync/` |
| `.claude/skills/bakers-build/` | The bakers.build skills and the `WORKFLOW.md` template |
| `docs/` | The manual and the site that renders it |

## Checks by area

`WORKFLOW.md` is the authority for which checks apply. The table summarizes it.

| When you change | Run |
|---|---|
| CLI, skills or `WORKFLOW.md` | `cd bakers-cli && pnpm --filter @bakers-build/core test && pnpm lint` |
| CLI source | `cd bakers-cli && pnpm install && pnpm -r run build` |
| PHP | The changed PHPUnit classes, each by path, then `ddev phpcs && ddev phpmd && ddev phpstan` |
| Drupal configuration | `bash tests/config-sync/check-config-sync.sh` |
| The web UI | The theme's Storybook build, the layout contract script under `tests/contract/`, and the Playwright suite in `tests/playwright` |
| A component directory added or removed | The data-display contract script under `tests/contract/`; it pins the component count |
| The manual | `cd docs && pnpm build` |

Run PHPUnit classes by path, for example `ddev exec ./vendor/bin/phpunit --configuration=phpunit.xml <path/to/ChangedTest.php>`, not with `--filter` or `--group`, which can report success when no test ran. The full suite is the CI job's work.

Drupal runtime checks run on the `recipe-test` world first and on the `existing-config` install last. A plain `ddev init` defaults to `existing-config`, so always name the provider with `ddev init --provider recipe-test`. `WORKFLOW.md` › *provision* gives the order. For the CLI's own tests, see [build from source](/development/build-from-source).

## Rules that catch most mistakes

- Stay as close to standard Drupal as possible. A listing is a View, and a custom controller or an island needs a concrete reason.
- Never patch a live server with `drush`. Fix the configuration in both `config/sync/**` and the matching recipe `config/**`.
- Components, stories, scenes and design tokens go through the Designbook skills (`designbook:design-component`, `design-screen`, `design-entity`, `design-shell`, `tokens`), never by hand.
- Write English only in documentation, code comments and skills.
- Deliver through a merge request that is squash-merged into the ticket's base branch ([git and delivery](https://github.com/bakers-build/bakers-build/blob/main/docs/bakers/git-and-delivery.md)). The commit carries `ref:<identifier>` as its last line, and the merge request title and description carry no ticket reference.

## In this section

Use these guides for the implementation or documentation your change touches.

<DocQuickLinks aria-label="Contributor guides" :items="[
  { label: 'Build the CLI from source', text: 'Build your checkout and rebuild after edits.', link: '/development/build-from-source' },
  { label: 'Addon contracts', text: 'Choose an extension point and implement its contract.', link: '/addons/build/contracts' },
  { label: 'Inbox messages', text: 'Build an addon whose messages appear on a ticket.', link: '/addons/build/actions' },
  { label: 'Skill contract', text: 'Understand the frame, recipes, runtime guides and project hints.', link: '/development/skill-contract' },
  { label: 'Write a recipe', text: 'Add an engineering method for plan, working and review.', link: '/skills-and-workflows/recipes' },
  { label: 'Architecture', text: 'Find the component that owns the behavior you want to change.', link: '/development/architecture' },
  { label: 'Write the docs', text: 'Follow the page rules and run the site checks.', link: '/development/write-docs' }
]" />

Every `develop` pipeline that deploys dev2 also publishes the site to GitLab Pages, so a merged documentation change is public after that pipeline; it is not a release claim.
