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
  // The run budget (`max_parallel`) is set on the machine in the backend,
  // default 5. A `max_parallel` here is ignored with a warning.
  // Lifecycle hooks are executor-owned + best-effort (BB-84): the executor
  // invokes each (after_create/before_run/after_done), logs loudly + continues
  // on failure, and never wedges a run — so they live at the config TOP LEVEL,
  // not on the workspace descriptor. after_create: env setup on worktree
  // create. before_run: install pnpm dependencies before every run, outside
  // the agent sandbox, which cannot take pnpm's store lock. after_done: reclaim
  // the worktree's DDEV project (containers + db) once its ticket is done,
  // before the conductor tears the worktree down.
  //
  // The project bootstrap validates env before its sentinel, then prepares the
  // local test workspace. It starts no DDEV; hook failures remain best-effort.
  hooks: {
    after_create: 'bash .ddev/worktree-post.sh',
    before_run: 'bash scripts/worktree-deps.sh',
    after_done: 'ddev delete -Oy',
    // The `provision_up(profile)` agent tool, so a sandboxed run needs neither
    // a trusted `ddev` nor `pnpm install`. Every profile installs the
    // bakers-cli and website dependencies first; `deps` does only that.
    // bb_theme is installed and built by `ddev init` inside DDEV.
    // `ddev provision` reuses a ready site of that provider;
    // `existing-config-fresh` always reinstalls.
    provision_up: {
      deps: 'bash scripts/worktree-deps.sh --all',
      'recipe-test': 'bash scripts/worktree-deps.sh && ddev provision --provider recipe-test',
      'existing-config': 'bash scripts/worktree-deps.sh && ddev provision --provider existing-config',
      'existing-config-fresh': 'bash scripts/worktree-deps.sh && ddev init --provider existing-config',
    },
  },
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
