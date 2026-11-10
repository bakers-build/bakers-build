// @bakers-schema-version 1
// Canonical conductor config for the bakers repo itself (dogfood). Targets the
// deployed develop control-plane (develop.dev.bakers.build). Auth is OAuth2
// client_credentials against simple_oauth (consumer `bakers-agent`), exposed as
// ONE default provider named `bakers` on ONE scope (`bb:session`) — see the
// sibling bakers.config.js. BB-391 retired the two named profiles that used to
// sit here differing only by OAuth scope; what it removed is the CHOICE between
// them, not the scope. One, not zero: `simple_oauth`'s Oauth2AccessPolicy
// rewrites a token account's permissions with `overwrite: TRUE`, so for the
// `client_credentials` token this config mints the permission set is EXACTLY the
// scope's — the scope is the ceiling on which OPERATIONS exist at all, and the
// OG rank the identity holds in its workspace (BB-359) decides which ROWS they
// reach. Non-secret connection params live here / in
// conductor.config.local.js; the shared client_secret is entered at
// `dropsh auth login` and tokens are stored at ~/.config/dropsh/<host>.json
// (0600) — never here. Requires dropsh >= 0.4.1 (auto-renew +
// descriptor-resolved slots).
//
// IMPORT-FREE (BB-78): the plugin slots + plugins[] are `{ plugin, with }`
// descriptors naming the REAL published package (`@bakers-build/addon-*`,
// `@dropsh/plugin-*`), not `import`ed constructors. loadConductorConfig
// resolves each name ESLint-style (config dir → cwd → conductor install), so
// config load no longer depends on `node_modules/@bakers-ai` being linked beside
// this file. Dev/monorepo resolves the per-package names via pnpm links from
// `.bakers/`; a global `@bakers-build/bakers` install resolves the same names as real
// npm deps installed alongside it.
// NO BARREL (BB-224 Finding 6): the former `@bakers-build/core/plugins` host barrel
// is DELETED — core is a surface-agnostic kernel and ships no impls. Every impl
// now lives in its own single-purpose addon package that default-exports its
// factory, so a slot just names that package and needs no `export:` (remote →
// `@bakers-build/addon-remote-drupal`, executor → `@bakers-build/addon-herdr`, agents →
// `@bakers-build/addon-{claude,codex,grok,kimi,opencode,pi}`). The only `export:` left is for
// a package shipping MORE than one slot: `@bakers-build/addon-herdr` default-exports
// the EXECUTOR, so the workspace slot names `export: 'herdrWorkspace'`
// (BB-139).

async function loadLocal() {
  try { return (await import('./conductor.config.local.js')).default ?? {}; } catch {}
  return {};
}

// Optional, gitignored; carries local values such as the FRP transport (`frp`),
// never an identity. The conductor is keyed by machine id + project + variant.
const local = await loadLocal();

export default {
  bakers: { project: 'bakers' },
  // Runs stay sandboxed, though the default mode is `system`. `bakers` and `git`
  // stay trusted until forge tools deliver (docs/decisions/sandbox-forge-tools.md);
  // a sandbox grants no global tools by default.
  permissions: { mode: 'sandbox', sandbox: { trusted_commands: ['bakers', 'git'] } },
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
  // The project bootstrap validates env before its sentinel, then prepares the
  // local test workspace. It starts no DDEV; hook failures remain best-effort.
  hooks: {
    after_create: 'bash .ddev/worktree-post.sh',
    before_run: 'bash scripts/worktree-deps.sh',
    after_done: 'bash scripts/docs-preview.sh stop; bash scripts/conductor-e2e.sh teardown; ddev delete -Oy',
    // The `provision_up(profile)` agent tool, so a sandboxed run needs neither
    // a trusted `ddev` nor `pnpm install`. Every profile installs the
    // bakers-cli and docs dependencies first; `deps` does only that.
    // bb_theme is installed and built by `ddev init` inside DDEV.
    // `ddev provision` reuses a ready site of that provider;
    // `existing-config-fresh` always reinstalls. `docs-preview` builds docs/
    // and serves it detached outside the sandbox, so the ports addon's `docs`
    // service claims it for `ports_up docs`; a repeat call replaces it.
    // `conductor-e2e` resets the recipe-test playground and starts a detached
    // playground conductor from this worktree's build; `-stop` and `-start`
    // stop and restart it without a reset (scripts/conductor-e2e.sh).
    provision_up: {
      deps: 'bash scripts/worktree-deps.sh --all',
      'docs-preview': 'bash scripts/worktree-deps.sh --all && bash scripts/docs-preview.sh',
      'conductor-e2e': 'bash scripts/worktree-deps.sh --all && ddev provision --provider recipe-test && bash scripts/conductor-e2e.sh',
      'conductor-e2e-stop': 'bash scripts/conductor-e2e.sh stop',
      'conductor-e2e-start': 'bash scripts/conductor-e2e.sh start',
      'recipe-test': 'bash scripts/worktree-deps.sh && ddev provision --provider recipe-test',
      'existing-config': 'bash scripts/worktree-deps.sh && ddev provision --provider existing-config',
      'existing-config-fresh': 'bash scripts/worktree-deps.sh && ddev init --provider existing-config',
    },
  },
  // The agent plugins every run of this project gets, installed into a
  // per-declaration agent home (~/.cache/bakers/agent-homes/<harness>/<hash>):
  // the skills WORKFLOW.md bb-phase-work and the recipes require. The bakers
  // skills themselves come from this checkout's .claude/skills/bakers-build.
  marketplaces: [
    { url: 'https://github.com/mattpocock/skills.git', ref: 'v1.3.2', plugins: ['mattpocock-skills'] },
    {
      url: 'https://github.com/pen-drop/designbook.git',
      ref: 'next',
      plugins: ['designbook', 'designbook-drupal', 'designbook-css-tailwind', 'designbook-figma'],
    },
    { url: 'https://github.com/DietrichGebert/ponytail.git', ref: 'v5.3.2', plugins: ['ponytail'] },
    { url: 'https://github.com/obra/superpowers.git', ref: 'v7.0.0', plugins: ['superpowers'] },
  ],
  remote: { plugin: '@bakers-build/addon-remote-drupal' },
  // addon-ddev serves the `ddev_status`, `ddev_start` and `ddev_exec` agent
  // tools, so runs reach DDEV only through the conductor, never directly.
  // Preview is opt-in; the FRP transport validates the operator's complete settings.
  addons: [
    '@bakers-build/addon-ddev',
    ...(local.frp ? [{
      use: '@bakers-build/addon-ports',
      with: {
        services: [{ key: 'docs', match: 'vitepress' }],
        // DDEV's containers are claimed by the addon-ddev claimer.
        claimers: ['@bakers-build/addon-ddev'],
        transport: {
          use: '@bakers-build/addon-ports-frp',
          with: local.frp,
        },
      },
    }] : []),
  ],
  // Layout per workflow state: project = workspace, run = tab.
  // No hard-wired diff pane for `review`: the review diff surface is hunk
  // (BB-55) — agent-driven + opt-in in the human's interactive pane
  // (see .claude/skills/bakers-build/reference/hunk-review-surface.md), not an
  // executor-forced `git diff` pane. Clicking a changed file in that hunk
  // pane opens it editable in a spiceedit overlay (see bakers-cli/README.md
  // + herdr/spiceedit).
  executor: { plugin: '@bakers-build/addon-herdr' },
  // Agents are a per-machine concern: the harness packages live in
  // ~/.bakers/machine.config.js `addons[]` and the selection policy under
  // `agents`. The conductor config declares no agents — only the
  // remote/executor/workspace engine wiring.
  // BB-139: the herdr workspace ships in @bakers-build/addon-herdr now (the former
  // plugin-herdr-workspace was merged in). That package default-exports the
  // EXECUTOR, so the workspace slot names export: 'herdrWorkspace'.
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
  workspace: {
    plugin: '@bakers-build/addon-herdr',
    export: 'herdrWorkspace',
  },
};
