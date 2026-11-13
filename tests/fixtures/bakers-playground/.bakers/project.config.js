// @bakers-schema-version 1
// Canonical project config for the bakers-playground target repo. The
// connection is the generated, untracked sibling connection.config.js; this file
// only describes how the conductor creates and runs ticket worktrees.
//
// THIS FILE IS THE ONLY AUTHORITY FOR THE ENGINE SURFACE. bakers.build's
// `.bakers/scripts/setup-test-project.sh` used to generate over it on every run and hide the
// difference with `--skip-worktree`; it no longer does. What that script still writes
// is the untracked connection. The conductor carries no identity: it is this machine +
// project + variant, keyed by the control plane. Everything structural is here and reviewable.

// Claims are dispatched in a per-ticket worktree. Resolve the first worktree
// as the parent clone, then inject the parent's local control-plane config and
// skill symlink into the exact worktree where the agent runs. The generated
// connection config is kept out of the ticket branch through git's local
// exclude file. WORKFLOW.md is NOT copied: it is a committed file of the fixture
// repo, so the worktree checks it out from `origin/<base_branch>` itself.
// Independent skill/client setup runs before env preparation. The final setup
// command propagates failure to the executor without hiding it.
//
// Skills come FIRST and link the FLAT directory `.../bakers-build/skills`, not the bundle
// `.../bakers-build`: the bundle carries no SKILL.md, and Claude Code loads
// `<project>/.claude/skills/<name>/SKILL.md`, so linking the bundle loads nothing.
// `.claude/settings.json` — which disables the globally enabled `bakers@bakers` plugin, the
// thing that otherwise wins over anything a project links — is NOT copied, for the same
// reason WORKFLOW.md is not: it is a committed file of this repo, so the worktree checks
// it out itself. Only the host-dependent halves are injected here.
/** @type {import('@bakers-build/core').ProjectConfig} */
export default {
  schema_version: 1,
  // `project.name` is read STATICALLY (readBbProjectSelection in
  // bakers-cli/conductor/src/cli/project-context.ts), without executing this
  // file, so it must be a literal string. The recipe-test world this fixture
  // targets always provisions the project named by
  // `.bakers/scripts/setup-test-project.sh`'s `--project` default, so that literal is
  // hardcoded here; a run against a DIFFERENT `--project` name needs this
  // line changed to match, or BAKERS_PROJECT set for that conductor.
  project: { name: 'bakers-e2e-project' },
  // Agent selection is a per-machine concern (~/.bakers/machine.config.js under
  // `agents.routes.default`), not declared here.
  // Agent addons are retired here too: the engine ignores/rejects them now —
  // agent addons belong in machine.config.js — so `@bakers-build/addon-claude` moved out;
  // the alias `opus` it provided must already be declared machine-wide.
  addons: [
    '@bakers-build/addon-remote-drupal',
    // Was missing entirely: with no ports entry here the conductor's own
    // `addons.empty` stayed true, so `start()` registered nothing and no
    // `ports` capability was ever available to answer a ticket's Share
    // tunnels message — regardless of how the engine/project config read.
    '@bakers-build/addon-ports',
    '@bakers-build/addon-herdr',
  ],
  // The conductor runs lifecycle hooks; addon-herdr rejects `with.hooks`.
  // A script in `.bakers/`, so an isolating runtime accepts it as a host command.
  hooks: { after_create: 'bash .bakers/scripts/after-create.sh' },
};
