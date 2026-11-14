// @bakers-schema-version 1
// The bakers repository's own project configuration (dogfood). The
// connection and its credentials are private (~/.bakers/connections/), the
// agents and their policy belong to each machine (~/.bakers/machine.config.js).
//
// Each addon in `addons` fills its slots through its preset; the loader
// resolves each name (config dir → cwd → CLI install). herdr supplies the
// executor and the worktree. The server comes from the connection, by default
// @bakers-build/addon-remote-drupal.

/** @type {import('@bakers-build/core').ProjectConfig} */
export default {
  schema_version: 1,
  project: { name: 'bakers' },
  // Runs stay sandboxed, though the default mode is `system`. A sandbox trusts
  // no command: delivery goes through the forge tools below
  // (docs/decisions/sandbox-forge-tools.md).
  permissions: { mode: 'sandbox' },
  // The run budget (`max_parallel`) is set on the machine in the backend,
  // default 5. A `max_parallel` here is ignored with a warning.
  // Lifecycle hooks are conductor-owned + best-effort: the conductor runs each
  // (after_create/before_run/after_done) in the worktree, logs loudly +
  // continues on failure, and never wedges a run — so they live at the config
  // TOP LEVEL, not on a plugin descriptor. after_create: env setup on worktree
  // create. before_run: install pnpm dependencies before every run, outside
  // the agent sandbox, which cannot take pnpm's store lock. after_done: reclaim
  // the worktree's docs preview, playground conductor and DDEV project (containers + db) once its
  // ticket is done, before the conductor tears the worktree down; `;` so the
  // DDEV cleanup runs whatever the preview stop returns.
  //
  // The project bootstrap validates env and registers the worktree's DDEV
  // project before its sentinel, then prepares the local test workspace. It
  // starts no DDEV; hook failures remain best-effort. Every hook that acts on a
  // DDEV project first runs .bakers/scripts/ddev-own-project.sh, which refuses the
  // parent checkout an unregistered worktree falls back to.
  hooks: {
    after_create: 'bash .bakers/scripts/worktree-post.sh',
    before_run: 'bash .bakers/scripts/worktree-deps.sh',
    after_done:
      'bash .bakers/scripts/docs-preview.sh stop; bash .bakers/scripts/conductor-e2e.sh teardown; bash .bakers/scripts/ddev-own-project.sh && ddev delete -Oy',
    // The `provision_up(profile)` agent tool, so a sandboxed run needs neither
    // a trusted `ddev` nor `pnpm install`. Setup profiles install the
    // bakers-cli and docs dependencies first; `deps` does only that. Under an
    // isolating runtime the host installs nothing: the run installs in its
    // own container (.bakers/scripts/worktree-deps.sh).
    // bb_theme is installed and built by `ddev init` inside DDEV.
    // `ddev provision` reuses a ready site of that provider;
    // `existing-config-fresh` always reinstalls. `docs-preview` builds docs/
    // and serves it detached outside the sandbox, so the ports addon's `docs`
    // service claims it for `ports_up docs`; a repeat call replaces it.
    // `conductor-e2e` resets the recipe-test playground and starts a detached
    // playground conductor from this worktree's build; `-stop` and `-start`
    // stop and restart it without a reset (.bakers/scripts/conductor-e2e.sh).
    // It runs the run's CLI build on the host: the one known exception to
    // "the host runs only protected code" (docs/decisions/run-isolation.md).
    provision_up: {
      deps: 'bash .bakers/provision.sh deps',
      'docs-preview': 'bash .bakers/provision.sh docs-preview',
      'conductor-e2e': 'bash .bakers/provision.sh conductor-e2e',
      'conductor-e2e-stop': 'bash .bakers/provision.sh conductor-e2e-stop',
      'conductor-e2e-start': 'bash .bakers/provision.sh conductor-e2e-start',
      'recipe-test': 'bash .bakers/provision.sh recipe-test',
      'existing-config': 'bash .bakers/provision.sh existing-config',
      'existing-config-fresh': 'bash .bakers/provision.sh existing-config-fresh',
    },
    // The `provision_exec(key, args?)` agent tool: each key is one fixed
    // command in the DDEV web container. Only keys with `args: true` take
    // arguments, which .bakers/provision.sh validates; none reaches a shell.
    provision_exec: {
      phpcs: 'bash .bakers/provision.sh exec phpcs',
      phpmd: 'bash .bakers/provision.sh exec phpmd',
      phpstan: 'bash .bakers/provision.sh exec phpstan',
      uli: { command: 'bash .bakers/provision.sh exec uli', args: true },
      playwright: { command: 'bash .bakers/provision.sh exec playwright', args: true },
      'playwright-cli': { command: 'bash .bakers/provision.sh exec playwright-cli', args: true },
      'playground-ticket': { command: 'bash .bakers/provision.sh exec playground-ticket', args: true },
    },
  },
  // Under an isolating runtime a run sees these read-only and cannot change
  // them in a commit: the host runs code only from here. A change to one is
  // made and merged by a maintainer outside the run.
  runtime: { read_only: ['.bakers', '.ddev', '.github'] },
  // The agent plugins every run of this project gets, installed into a
  // per-declaration agent home (~/.cache/bakers/agent-homes/<harness>/<hash>):
  // the skills WORKFLOW.md bb-phase-work and the recipes require. The bakers
  // skills themselves come from this checkout's .claude/skills/bakers-build.
  marketplaces: [
    {
      url: 'https://github.com/mattpocock/skills.git',
      ref: 'v1.3.2',
      plugins: ['mattpocock-skills'],
    },
    {
      url: 'https://github.com/pen-drop/designbook.git',
      ref: 'next',
      plugins: [
        'designbook',
        'designbook-drupal',
        'designbook-css-tailwind',
        'designbook-figma',
      ],
    },
    {
      url: 'https://github.com/DietrichGebert/ponytail.git',
      ref: 'v5.3.2',
      plugins: ['ponytail'],
    },
    {
      url: 'https://github.com/obra/superpowers.git',
      ref: 'v7.0.0',
      plugins: ['superpowers'],
    },
  ],
  // addon-ddev serves the `ddev_status` and `ddev_start` agent tools, so runs
  // reach DDEV only through the conductor, never directly; commands in the
  // web container run through `provision_exec('web', …)`.
  // Preview links: the project names its services; each machine adds the
  // transport in its own ~/.bakers/machine.config.js ports entry, e.g.
  // { use: '@bakers-build/addon-ports', with: { transport: { use:
  // '@bakers-build/addon-ports-frp', with: { … } } } }, merged with this one.
  addons: [
    '@bakers-build/addon-ddev',
    // Layout per workflow state: project = workspace, run = tab.
    // No hard-wired diff pane for `review`: the review diff surface is hunk
    // (BB-55) — agent-driven + opt-in in the human's interactive pane
    // (see .claude/skills/bakers-build/reference/hunk-review-surface.md), not an
    // executor-forced `git diff` pane. Clicking a changed file in that hunk
    // pane opens it editable in a spiceedit overlay (see bakers-cli/README.md
    // + herdr/spiceedit).
    //
    // No `with.open`: the addon's shipped default (BB-234,
    // `bakers ui --ticket {identifier}`) is what this repo wants. It carried a
    // sentinel wait loop until BB-237 fixed the ordering that made one
    // necessary; the leftover override was then byte-identical to the default and
    // was deleted, so bakers cannot silently stop following it if it ever changes.
    //
    // BB-390 removed what used to be noted here: the ~/.local/bin/bakers shim no
    // longer hard-requires this checkout's own build inside a bakers worktree, so the
    // pane command does NOT depend on `after_create` having built anything. Inside a
    // bakers worktree a bare `bakers` is the globally installed CLI; the branch build is
    // selected only inside a `.bakers-testbuild` workspace, and reached by explicit
    // path (`./bakers-cli/bin/bakers`) anywhere else.
    '@bakers-build/addon-herdr',
    '@bakers-build/addon-agents',
    '@bakers-build/addon-deployment',
    {
      use: '@bakers-build/addon-ports',
      with: {
        services: [{ key: 'docs', match: 'vitepress' }],
        // DDEV's containers are claimed by the addon-ddev claimer.
        claimers: ['@bakers-build/addon-ddev'],
      },
    },
    // Runs fetch, push, open PRs, read checks and merge only through the forge
    // tools; the conductor's own `gh` login supplies the token, which no run sees.
    // `next` takes squashed feature PRs, `main` only merge commits from `next`.
    {
      use: '@bakers-build/addon-forge',
      with: {
        merge: {
          next: { method: 'squash', delete_source: true },
          main: { method: 'merge', delete_source: false },
        },
        backend: {
          use: '@bakers-build/addon-forge-github',
          with: { repository: 'bakers-build/bakers-build', auth: 'gh' },
        },
      },
    },
  ],
};
