// Canonical conductor config for the bakers-playground target repo. The
// connection surface lives in the generated sibling bakers.config.js; this file
// only describes how the conductor creates and runs ticket worktrees.
//
// THIS FILE IS THE ONLY AUTHORITY FOR THE ENGINE SURFACE. bakers.build's
// `scripts/setup-test-project.sh` used to generate over it on every run and hide the
// difference with `--skip-worktree`; it no longer does. What that script still writes
// is the untracked machine override `conductor.config.local.js`, which supplies only
// `project` and `machine_id` — the two values that cannot be committed because they
// identify one machine's run. Everything structural is here and reviewable.

async function loadLocal() {
  try {
    return (await import('./conductor.config.local.js')).default ?? {};
  } catch {}
  return {};
}

const local = await loadLocal();

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
const parentSetupHook = [
  'parent=$(git worktree list --porcelain | head -1 | cut -c 10-)',
  ['mkdir -p .claude', 'ln -sfn "$parent/.claude/skills" .claude/skills'].join(' && '),
  ['mkdir -p .bakers', 'cp -f "$parent/.bakers/bakers.config.js" .bakers/bakers.config.js', 'cp -f "$parent/.bakers/conductor.config.local.js" .bakers/conductor.config.local.js'].join(' && '),
  'exclude=$(git rev-parse --git-path info/exclude)',
  'for p in .bakers/bakers.config.js .bakers/conductor.config.local.js .claude/skills; do grep -qxF "$p" "$exclude" || echo "$p" >> "$exclude"; done',
  // Last: independent skill/client setup survives an observable env setup failure.
  'node scripts/setup-worktree.mjs',
].join('; ');

// NO `states` KEY, and that is the point rather than an omission: an absent or empty
// list makes the conductor serve EVERY claimable state of its project. A
// narrowed slice is what made one live run unrecoverable — the agent legitimately
// routed the ticket back to `qualification`, the slice did not serve it, and the
// ticket could never be claimed again. This rule used to live in the generated config
// and was lost the moment generation stopped; it belongs here, with the file that now
// decides it.
export default {
  // `bakers.project` is read STATICALLY (readBbProjectSelection in
  // bakers-cli/conductor/src/cli/project-context.ts), without executing this
  // file, so it must be a literal string — `local.project ?? '…'` throws
  // "Cannot read committed bakers.project". The recipe-test world this fixture
  // targets always provisions the project named by
  // `scripts/setup-test-project.sh`'s `--project` default, so that literal is
  // hardcoded here; a run against a DIFFERENT `--project` name needs this
  // line changed to match (a per-machine override is not supported for this
  // key under the current engine).
  bakers: { project: 'bakers-e2e-project' },
  conductor_id: local.conductor_id ?? local.machine_id,
  states: local.states ?? [],
  // Agent selection is a per-machine concern (~/.bakers/machine.config.js under
  // `agents`), not declared here — the stale `default_agent: { '*': 'opus' }`
  // this file used to carry collided with the engine's own reserved default
  // route (`conflicting_values [default_agent]`).
  // Agent addons are retired here too: the engine ignores/rejects them now —
  // "agent addons in a conductor config are ignored; declare them in
  // machine.config.js 'agents.addons'" — so `@bakers-build/addon-claude` moved out;
  // the alias `opus` it provided must already be declared machine-wide.
  addons: [
    '@bakers-build/addon-remote-drupal',
    // Was missing entirely: with no ports entry here the conductor's own
    // `addons.empty` stayed true, so `start()` registered nothing and no
    // `ports` capability was ever available to answer a ticket's Share
    // tunnels message — regardless of how the engine/project config read.
    '@bakers-build/addon-ports',
    {
      use: '@bakers-build/addon-herdr',
      with: { hooks: { after_create: parentSetupHook } },
    },
  ],
};
