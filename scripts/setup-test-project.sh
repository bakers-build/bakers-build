#!/usr/bin/env bash
# =============================================================================
# setup-test-project.sh — bring up the environment a hand-driven Conductor run
#                         needs, and nothing more.
#
#   scripts/setup-test-project.sh [--project <name>] [--workspace-only]
#                                 [--fixture-repo <url>]
#   scripts/teardown-test-project.sh          # gives it all back
#
#     --project <name>  the bb_project of the recipe-test world to wire up. It is
#                       also what the conductor's machine_id is composed from, so
#                       teardown must be given the SAME name or it purges nothing.
#                       Default: bakers-e2e-project.
#     --fixture-repo <url>
#                       clone the fixture project from this remote instead of the
#                       local bare repository, for a run that needs a real remote
#                       (e.g. to see a merge request opened). Default: the local
#                       bare repository `workspaces/bakers-playground.git`, created
#                       on first run by committing tests/fixtures/bakers-playground
#                       on branch develop. It is not re-seeded while it exists, so
#                       run teardown first to pick up a changed fixture tree.
#     Branch selection: current source branch, then its ticket parent's branch
#                       (if any), then develop. Ticket branches use their lowercase
#                       identifier, e.g. feat/shop-27-cart becomes shop-27.
#                       Select existing local/remote branches only. Keep WORKFLOW.md
#                       and local edits; never reset, create remote branches or push.
#                       A failed checkout stops setup; only absent branches fall back.
#     --workspace-only  the mode `ddev init-worktree` uses: THE WORKSPACE SIDE ONLY,
#                       with no control-plane provisioning and no DDEV start. Steps
#                       3, 4, 6 and 7 run; steps 2, 5, 8 and 9 are skipped. Step 2 is
#                       the load-bearing exclusion — a worktree just built by
#                       `ddev init-worktree` has the default world, in which the
#                       project does not exist, so the unguarded script would take
#                       its "not found" branch and run `ddev init --provider
#                       recipe-test`, WIPING the database that bootstrap had just
#                       built. Steps 5, 8 and 9 are control-plane writes only a
#                       hand-driven run needs. A plain run performs all nine and
#                       remains the command that prepares such a run. This mode needs
#                       NO RUNNING DDEV: `ddev init-worktree` does not start the
#                       worktree it configures, so when `ddev describe` cannot answer,
#                       the project name and URL are derived (see step 1).
#
# It does NOT create a ticket and does NOT register a conductor. Those are yours:
# the script hands you a working control plane and a working work workspace, and
# prints the two commands that follow. Driving a run costs real agent money, so
# the step that spends it is deliberately not automated here (BB-286 automates
# the drive and the judging).
#
# TWO ENVIRONMENTS, and confusing them is the main hazard:
#
#   * the CONTROL PLANE is the bakers DDEV of the checkout this script runs in. It
#     hosts the bakers Drupal the conductor talks to, and every control-plane write
#     below goes through `ddev drush` here — which cannot reach dev2 or prod at
#     all, so the wrong-control-plane class of bug is removed rather than guarded.
#   * the WORK WORKSPACE is `workspaces/bakers-playground`, a clone of the fixture
#     project (tests/fixtures/bakers-playground, via its local bare repository).
#     It runs NO bakers Drupal of its own. It has a DDEV purely so the skill
#     under test can issue real `ddev` commands, and it is the base the conductor
#     creates per-ticket worktrees beside.
#
# `workspaces/` is gitignored in every bakers checkout, so the workspace is
# per-checkout and must be creatable from nothing. Everything here is idempotent:
# a second run is a fetch plus a rewrite of the two generated files.
#
# FACTS THAT BITE, each established empirically rather than read from a manual:
#
#  1. NOTHING THIS SCRIPT WRITES OVERWRITES A COMMITTED FILE ANY MORE, and that is a
#     correction rather than a description of how it always was. It used to generate
#     three files over what the fixture ships — `WORKFLOW.md`, the engine config, the
#     connection config — because the fixture once committed a pre-BB-204 loader
#     (`## State:` sections, no loaded skills) and a stale pre-BB-201 engine config.
#     The fixture now commits a real BB-204 loader AND a real engine config, so both
#     are hand-maintained there and this script leaves them alone. What remains
#     generated is machine-local and untracked: the CONNECTION config (secrets, this
#     run's control plane) and `.bakers/conductor.config.local.js` (project + machine_id).
#     The old arrangement cost a run: two authors for one path, `--skip-worktree`
#     hiding the difference, and a correct committed fix silently overwritten on the
#     next setup. A generated file that shadows a tracked one hides its own damage.
#  2. `bb_ticket.base_branch` is COMPUTED: the parent's branch, else the FIRST
#     project repo `default_branch`, else the literal "main". The recipe-test world
#     seeds `bakers-e2e-project` with no repo entry, so every ticket fell through to
#     "main" — a branch of the fixture that carries no WORKFLOW.md at all. Step 5
#     is what fixes that, and it READS the clone's branch rather than assuming it.
#  3. The control plane's OAuth2 keys live outside any mounted volume, so a
#     `ddev stop`/`start` DESTROYS them and the session mint then fails with an
#     HTTP 500 naming neither DDEV nor the cause. Step 8 repairs that silently.
#  4. The fixture repo carries a project-owned, pre-addon `init-worktree` that
#     overwrites the tracked `.ddev/config.yaml`, derives a name identical in
#     every checkout, and provisions a Drupal site. It is deliberately NOT used;
#     step 4 writes the addon-shaped git-ignored overlay itself.
#  5. A BARE `bakers` INSIDE THE WORKSPACE IS THIS CHECKOUT'S BUILD, and the mechanism
#     is a file THIS SCRIPT WRITES: step 6 drops `<workspace>/.bakers-testbuild`, whose
#     single line is this checkout's absolute path, and `~/.local/bin/bakers` walks up
#     the filesystem looking for exactly that marker (BB-390). So the workspace —
#     the one place the branch build is under test — runs the branch build, while a
#     bare `bakers` anywhere else on this machine, INSIDE A bakers.build CHECKOUT INCLUDED, is
#     the released CLI. That is the mechanism, not a leak: it used to be the
#     inverse, with the shim keying on the git toplevel, which meant the build was
#     reachable exactly where it was not needed and absent where it was.
#     This script still calls the CLI through `${BB_BIN}` for the invocations it
#     makes BEFORE the marker exists; you do not have to.
#  6. THE FIXTURE'S COMMITTED WORKFLOW IS THE ENTRY LINE PLUS ONE VALIDATE ROW. Every
#     state runs through `@bakers-build/bb-workflow`, and `plan`/`working`/`review` run
#     the ticket's recipe (`bb-recipe-matt` by default). Read
#     `workspaces/bakers-playground/WORKFLOW.md` before creating a ticket: its
#     `## validate` row is the check a `working` run must report, and that file — not
#     this script — is where the answer lives.
#  7. RE-DRIVING THE SAME TICKET NEEDS ITS RUN DELETED, not released. A `bb_run`
#     whose `state_at_start` equals the ticket's current state blocks re-claiming
#     even once it is released or terminal, so clearing `conductor_id` alone leaves
#     a ticket that is silently never picked up again — the symptom is "it stopped
#     being claimed and I cannot see why". `claim_expires_at` lives on `bb_run`
#     too, not on the ticket. So the reset is `$run->delete()` for every run of that
#     ticket, via `ddev drush php:eval` in this checkout.
#  8. THE SKILL LINK REACHES A CLAUDE-FAMILY AGENT ONLY. Step 6 links
#     `.claude/skills` into the workspace, which is a PROJECT-LOCAL directory that
#     Claude Code reads. Codex resolves skills GLOBALLY from `~/.codex/skills/`
#     (marketplaces in `~/.codex/config.toml`) and has no project-local override,
#     so a Codex dispatch loads the machine's installed skills and not this branch
#     — silently, with a normal-looking run to show for it. Measured on BB-525:
#     a dispatch loaded a globally installed bakers skill symlinked from
#     `~/.agents/skills/`, which carried none of the branch's changes.
#     Step 6 warns when `~/.codex/skills` exists. When the SKILLS are what is under
#     test, dispatch with a Claude-family agent; otherwise the harness is a
#     false-negative machine and reports nothing about it.
#  9. THE CONTROL-PLANE WORLD CAN BE OLDER THAN THE CHECKOUT. Step 2 skips
#     provisioning when the project already exists, so a world built before a
#     rebase keeps its old entity schema, and a step that reads a changed
#     entity field fails with exit 1 and no message. Reinstalling the world
#     (`ddev init --provider recipe-test --fresh`) is the repair.
# =============================================================================
set -euo pipefail

PROJECT='bakers-e2e-project'
# `--workspace-only` — see the header. Default 'no': a hand-driven run does all nine
# steps, and the reduced mode is opted INTO by the one caller that must not
# re-provision the world (.ddev/worktree-post.sh).
WORKSPACE_ONLY='no'
WORKSPACE_RELPATH='workspaces/bakers-playground'
# Empty means the local bare repository seeded from FIXTURE_TREE_RELPATH (step 3).
FIXTURE_REPO=''
FIXTURE_TREE_RELPATH='tests/fixtures/bakers-playground'
FIXTURE_BRANCH='develop'

# The one credentialled identity the recipe-test world ships
# (recipes/bb_e2e/content/consumer/). Its recipe-seeded secret is stored
# PRE-HASHED, so the plaintext exists nowhere in the repository and cannot be put
# in a generated config. This script therefore owns the credential: it writes this
# secret onto the consumer and emits the same value into the generated connection
# config. A fixed constant rather than a random one, so a re-run is a true no-op.
# Safe as a constant because the guard refuses any host but a local *.ddev.site.
# NOTE: this MUTATES a recipe-seeded fixture and teardown does not restore it;
# `ddev init --provider recipe-test` resets it along with everything else.
CLIENT_ID='bakers-agent-e2e'
CLIENT_SECRET='skill-eval-secret'
# BB-495: the workspace the generated connection config focuses `bakers ui` on —
# OPTIONAL at the top level of a bakers.config.js since BB-495, but still written
# here, so it has to be a known value before step 7 writes that file. `bakers dropsh`
# reads nothing from it; the caller names its workspace on each call.
# A constant, because it IS one: it is
# `BbWorkspace::DEFAULT_UUID`, seeded on every install path by
# `bb_core_install()` -> `DefaultWorkspace::ensure()`, so every recipe-test
# world has exactly this workspace. Keep the two in sync if that constant ever
# changes.
WORKSPACE_ID='2a92d03c-c4c6-41dc-b194-31aa299ed064'
# BB-391: the generated connection declares ONE provider on ONE scope, and it
# is the SAME scope the committed config names — the e2e world no longer has a
# scope of its own. Two constants used to sit here, one per profile; now there is
# one, and the generated config finally matches the shape `bakers conductor init`
# writes.
OAUTH_SCOPE='bb:session'
#
# Why the scope carries the capability rather than a role: `bb:session` is an
# UMBRELLA over one child scope per permission, so it grants no `user_role` at
# all. That is deliberate. BbGroupScopedAccount::hasPermission() honours any
# permission a role the ACCOUNT holds grants, WITHOUT bounding it to a group, so
# a role would be a rank-fence bypass waiting to be assigned. With no role, the
# account's own role set stays `authenticated`, the fence keeps bounding every
# row to the groups its ranks name, and the scope only decides which OPERATIONS
# exist at all.
#
# The provider id is `bakers`: it names the CONNECTION, not a capability.
OAUTH_PROVIDER_ID='bakers'

usage() {
  awk 'NR <= 2 { next } /^# =+$/ { exit } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
}

die() { echo "ERROR: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
say() { echo "   $*"; }

# Escape a value for interpolation into a SINGLE-QUOTED PHP string literal, the
# form every `drush php:eval` snippet below uses. Only `\` and `'` are special
# there, and the backslash must be doubled FIRST or it would also double the one
# the quote escape introduces. Every value that reaches PHP goes through this and
# is carried in a `Q_`-prefixed variable, which is the invariant
# tests/contract/test-project-guard.sh asserts — an apostrophe used to
# close the literal early, so the container answered with a PHP parse error
# instead of a named failure.
php_str() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g"
}

# Read the OAuth2 key probe from stdin and print "<directory><TAB>ok|bad".
#
# The probe has THREE outcomes, not two, and the third one — the probe itself did
# not run — is the one that must never be reported as the first. Collapsing it into
# "usable" makes step 9 die on exactly the HTTP 500 step 8 exists to prevent, after
# telling the operator there was nothing to do. So an answer that is not exactly
# two key lines is fatal here rather than interpreted.
#
# `MIXED` is a directory, not a state: one `generate-keys` call cannot satisfy two
# directories, and fixing half of it would leave a control plane that still 500s.
parse_key_probe() {
  local name path state dir lines=0 result='ok' key_dir=''
  # `|| [ -n "${name}" ]` so a final line without a trailing newline still counts:
  # `read` reports EOF for it, and dropping it would turn a complete answer into the
  # "half-answered" failure this function exists to raise.
  while IFS=$'\t' read -r name path state || [ -n "${name}" ]; do
    [ -n "${name}" ] || continue
    lines=$((lines + 1))
    # `>&2`, and it is not cosmetic: this function's STDOUT is its return value, so
    # a diagnostic printed there is captured by the caller and became part of
    # KEY_DIR — which then reached `mkdir -p` and `generate-keys` as a directory name
    # made of the report itself. A live run found this; the unit stub had silenced
    # `say` and could not.
    [ "${state}" = 'ok' ] || { result='bad'; say "${name}: ${state} at ${path:-<not configured>}" >&2; }
    [ -n "${path}" ] || continue
    dir="$(dirname "${path}")"
    if [ -z "${key_dir}" ]; then key_dir="${dir}"
    elif [ "${key_dir}" != "${dir}" ]; then key_dir='MIXED'
    fi
  done
  [ "${lines}" -eq 2 ] \
    || die "the OAuth2 key probe answered with ${lines} key line(s) instead of 2, so
       whether the keys are usable is UNKNOWN. Reporting them as fine is what makes
       step 9 fail with an unexplained HTTP 500 — fix the control plane first."
  printf '%s\t%s\n' "${key_dir}" "${result}"
}

test_branch_name() {
  local branch="$1" leaf="${1##*/}"
  if [[ "$leaf" =~ ^([[:alpha:]][[:alnum:]]*-[0-9]+)(-|$) ]]; then
    printf '%s\n' "${BASH_REMATCH[1],,}"
  else
    printf '%s\n' "$branch"
  fi
}

workspace_has_branch() {
  [ -n "$2" ] || return 1
  git -C "$1" show-ref --verify --quiet "refs/heads/$2" \
    || git -C "$1" show-ref --verify --quiet "refs/remotes/origin/$2"
}

parent_branch_for() {
  local key response
  key="$(test_branch_name "$1")"
  [[ "$key" =~ ^[[:alpha:]][[:alnum:]]*-[0-9]+$ ]] || return 0
  # Read through the source checkout's normal connection, before entering the
  # playground. A lookup failure is not evidence that the ticket has no parent.
  response="$(bakers dropsh --format json search bb_ticket --bundle bb_ticket \
    --filter "identifier:${key^^}")" || die "cannot resolve parent for $key"
  jq -r '
    if (.data | type) != "array" or (.data | length) > 1 then
      error("ticket lookup did not return an unambiguous collection")
    elif (.data | length) == 0 or .data[0].relationships.parent_id.data == null then ""
    else .data[0].attributes.base_branch // error("parent branch is unavailable")
    end' <<<"$response" || die "cannot resolve parent for $key"
}

# Create the local bare origin from the committed fixture tree, once. An existing
# bare repository is left alone: runs push ticket branches to it.
seed_fixture_origin() {
  local tree="$1" bare="$2" index commit
  [ -d "${bare}" ] && return 0
  git init -q --bare "${bare}"
  index="${bare}/seed-index"
  commit="$(cd "${tree}" && export GIT_DIR="${bare}" GIT_WORK_TREE="${tree}" GIT_INDEX_FILE="${index}" \
      GIT_AUTHOR_NAME='bakers.build fixture' GIT_AUTHOR_EMAIL='fixture@bakers.invalid' \
      GIT_COMMITTER_NAME='bakers.build fixture' GIT_COMMITTER_EMAIL='fixture@bakers.invalid'
    git add -A . && git commit-tree "$(git write-tree)" -m "Seed from ${tree##*/}")" \
    || { rm -rf "${bare}"; die "cannot seed the fixture origin from ${tree}"; }
  rm -f "${index}"
  git --git-dir="${bare}" update-ref "refs/heads/${FIXTURE_BRANCH}" "${commit}"
  git --git-dir="${bare}" symbolic-ref HEAD "refs/heads/${FIXTURE_BRANCH}"
}

select_workspace_branch() {
  local workspace="$1" source="$2" parent="$3" candidate branch='' current
  for candidate in "$source" "$parent" develop; do
    candidate="$(test_branch_name "$candidate")"
    [ -n "$candidate" ] || continue
    if workspace_has_branch "$workspace" "$candidate"; then
      branch="$candidate"
      break
    fi
  done
  [ -n "$branch" ] || die "no current, parent or develop branch exists in the playground"
  current="$(git -C "$workspace" branch --show-current)"
  [ "$current" != "$branch" ] || return 0
  if ! git -C "$workspace" diff --quiet || ! git -C "$workspace" diff --cached --quiet; then
    die "workspace has tracked edits; preserve them before switching to '$branch'"
  fi
  if git -C "$workspace" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$workspace" switch -- "$branch" || die "cannot switch to '$branch'"
  else
    git -C "$workspace" switch --track -c "$branch" "origin/$branch" \
      || die "cannot check out 'origin/$branch'"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:?--project needs a value}"; shift 2 ;;
    --workspace-only) WORKSPACE_ONLY='yes'; shift ;;
    --fixture-repo) FIXTURE_REPO="${2:?--fixture-repo needs a value}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown argument '$1' (try --help)" ;;
  esac
done

# `--project` names a bb_project and is reached by more sinks than PHP: it is
# interpolated into the generated JS engine config and into the composed
# machine_id. Escaping it per sink would mean three escapers; a machine name has
# no business carrying a quote, so it is refused at the door instead — which
# leaves php_str responsible only for the values this script cannot constrain
# (a git URL, a branch name).
case "${PROJECT}" in
  '' | *[!A-Za-z0-9._-]*)
    die "--project '${PROJECT}' must be a bb_project machine name
       ([A-Za-z0-9._-] only): it is interpolated into generated JS and PHP" ;;
esac

Q_PROJECT="$(php_str "${PROJECT}")"
Q_CLIENT_ID="$(php_str "${CLIENT_ID}")"
Q_CLIENT_SECRET="$(php_str "${CLIENT_SECRET}")"

# pnpm is in the list because step 6 BUILDS when the linked packages are missing or
# stale (BB-390) — the build is this script's job now, not a precondition it checks
# and refuses on.
for tool in git ddev jq node pnpm; do
  command -v "$tool" >/dev/null || die "'$tool' is required but not on PATH"
done


ROOT="$(git rev-parse --show-toplevel)"
WORKSPACE="${ROOT}/${WORKSPACE_RELPATH}"
BB_BIN="${ROOT}/bakers-cli/bin/bakers"

# Force plain http and drop any trailing slash, so two spellings of the same
# control plane compare equal. http is forced rather than merely accepted: clients
# reject DDEV's self-signed certificate, so nothing here speaks TLS to it.
normalize_url() {
  printf '%s' "$1" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://#http://#; s#/+$##'
}

# Is this URL's HOST a local DDEV site? The single gate between a test harness and
# a real control plane, so it parses rather than pattern-matches: a glob over the
# whole URL (`http://*.ddev.site`) admits
# `http://develop.dev.bakers.build/x.ddev.site`, because `*` matches `/` too.
# So the host is cut out first — path, query, fragment and port removed — and
# userinfo is refused outright rather than parsed, since `ddev describe` never
# produces it and `http://x.ddev.site@remote.example.com` is the classic spoof.
is_local_ddev_host() {
  local rest host
  case "$1" in
    http://* | https://*) rest="${1#*://}" ;;
    *) return 1 ;;
  esac
  rest="${rest%%/*}"
  rest="${rest%%\?*}"
  rest="${rest%%#*}"
  case "${rest}" in *@*) return 1 ;; esac
  host="${rest%%:*}"
  case "${host}" in
    *.ddev.site) return 0 ;;
    *) return 1 ;;
  esac
}

# Run drush in the control plane. This is the ONLY way this script writes to the
# control plane, and it is why the wrong-control-plane hazard is structural rather
# than guarded: `ddev drush` cannot reach a remote instance. It also runs as the
# Drupal root user, so no access handler gates a write the recipe-test world's one
# identity could not perform itself.
cp_drush() { ( cd "${ROOT}" && ddev drush "$@" ); }

# A fresh checkout has no Composer vendor tree yet, so the first `ddev drush`
# call cannot be the project probe below. Bootstrap the CLI dependencies after
# the local-control-plane guard, where it is safe to run DDEV commands. The
# recipe-test provider still owns Drupal/site provisioning; this only makes
# Drush available so the script can decide whether that provisioning is needed.
ensure_drush() {
  if ( cd "${ROOT}" && ddev drush --version >/dev/null 2>&1 ); then
    return 0
  fi

  say "Drush is unavailable — installing Composer dependencies"
  ( cd "${ROOT}" && ddev composer install )
  ( cd "${ROOT}" && ddev drush --version >/dev/null 2>&1 ) \
    || die "Drush is still unavailable after 'ddev composer install'"
}

# `ddev start`, tolerating the TWO failures a shared DDEV host produces that say
# nothing about this project. Both were observed here, on a machine carrying 85
# registered DDEV projects:
#
#  1. THE ROUTER HEALTH WINDOW. `ddev-router` exceeds its own 60s health window on
#     a cold start ("Router count mismatch: 86 loaded, 164 expected") and `ddev
#     start` exits non-zero although the project's containers came up and became
#     routable moments later. So a failure is re-checked against the project's
#     ACTUAL status, and only then fatal.
#  2. THE GLOBAL-COMMANDS RACE. Another project's `ddev start` transiently
#     repopulates the shared `/mnt/ddev-global-cache` volume; a container starting
#     inside that window dies with "chown: cannot access
#     '/mnt/ddev-global-cache/global-commands'" while `ddev start` reports only
#     "container exited". It is a race, not a broken project, so it is retried —
#     and it is the ONLY failure that is. Not defensive padding: this transient has
#     destroyed a live run twice, and losing the retry while porting this script
#     from its predecessor is what made the third consecutive setup here fail.
start_ddev() {
  local approot="$1" name="$2" attempt status
  for attempt in 1 2 3; do
    if ( cd "${approot}" && ddev start -y ); then return 0; fi

    status="$( ( cd "${approot}" && ddev describe -j 2>/dev/null ) | jq -r '.raw.status // ""')"
    if [ "${status}" = 'running' ]; then
      say "WARNING: 'ddev start' reported a failure for '${name}' but it is running"
      say "         (usually the shared ddev-router health window) — continuing"
      return 0
    fi

    if ( cd "${approot}" && ddev logs -s web 2>&1 ) | grep -q 'ddev-global-cache/global-commands'; then
      [ "${attempt}" -lt 3 ] || die "ddev start kept losing the shared global-commands
       volume for '${name}' after ${attempt} attempts — another project's 'ddev start'
       may still be repopulating it; re-run in a moment"
      say "attempt ${attempt}: another project was repopulating the shared"
      say "         global-commands volume — retrying"
      continue
    fi

    die "ddev start failed for '${name}' and it is not running"
  done
}

# -----------------------------------------------------------------------------
step "1. control plane — this checkout's own bakers DDEV"
# -----------------------------------------------------------------------------
# DESCRIBE ONLY, and in `--workspace-only` not even that is guaranteed to answer.
# `ddev init-worktree` deliberately does NOT start the worktree it configures —
# `ddev init` owns the start — and this mode runs as its FINAL
# step, in a worktree whose project is therefore neither running nor yet registered;
# `ddev describe` then fails outright ("a project ... already exists for <parent>",
# because the overlay is the only thing giving this checkout its own name).
#
# Nothing this mode does needs a running control plane: steps 2, 5, 8 and 9 are the
# only ones that talk to it, and all four are skipped. So the name and URL are
# DERIVED when describe cannot answer, exactly as `.ddev/worktree-post.sh` already
# derives this worktree's base_url from DDEV_WORKTREE_NAME. That keeps the guard
# below meaningful rather than bypassed: a `<name>.ddev.site` host is local by
# construction. A FULL run still requires describe — it is about to write to that
# control plane, so it must read it rather than assume it.
described="$( ( cd "${ROOT}" && ddev describe -j 2>/dev/null ) | jq -c '.raw // empty' 2>/dev/null || true)"
if [ -n "${described}" ]; then
  CP_NAME="$(printf '%s' "${described}" | jq -r '.name')"
  CP_STATUS="$(printf '%s' "${described}" | jq -r '.status // ""')"
  # Both spellings are kept: the normalized one is what gets written into the config
  # and compared, the raw one is what a failure message must name — telling an
  # operator their control plane is 'http://…' when they configured https reads as a
  # different problem from the one the guard actually found.
  RAW_URL="$(printf '%s' "${described}" | jq -r '.httpurl // .primary_url // ""')"
else
  [ "${WORKSPACE_ONLY}" = 'yes' ] \
    || die "'ddev describe' could not describe the checkout at ${ROOT}. A full run reads
       the control plane it is about to write to, so this is fatal here; 'ddev start' in
       the checkout, or run with --workspace-only, which needs no running DDEV."
  # The project name, in falling order of authority: what init-worktree exported, the
  # git-ignored per-checkout overlay it writes, then the tracked config (which names
  # the PARENT project — last resort, and the reason the overlay exists at all).
  CP_NAME="${DDEV_WORKTREE_NAME:-}"
  if [ -z "${CP_NAME}" ] && [ -f "${ROOT}/.ddev/config.worktree.yaml" ]; then
    CP_NAME="$(awk '/^name:/ { print $2; exit }' "${ROOT}/.ddev/config.worktree.yaml")"
  fi
  if [ -z "${CP_NAME}" ] && [ -f "${ROOT}/.ddev/config.yaml" ]; then
    CP_NAME="$(awk '/^name:/ { print $2; exit }' "${ROOT}/.ddev/config.yaml")"
  fi
  [ -n "${CP_NAME}" ] \
    || die "--workspace-only: 'ddev describe' answered nothing and no DDEV project name
       could be read from DDEV_WORKTREE_NAME, .ddev/config.worktree.yaml or
       .ddev/config.yaml, so the control-plane URL cannot be derived either."
  CP_STATUS='not described'
  RAW_URL="https://${CP_NAME}.ddev.site"
fi
BASE_URL="$(normalize_url "${RAW_URL}")"
[ -n "${BASE_URL}" ] || die "ddev describe reported no URL for the checkout at ${ROOT}"

if [ "${CP_STATUS}" != 'running' ]; then
  if [ "${WORKSPACE_ONLY}" = 'yes' ]; then
    # Not fatal, and not started either: see above. Said out loud, because the
    # generated connection config points at a control plane that is not up yet.
    say "'${CP_NAME}' is ${CP_STATUS} — continuing, because this mode reads and writes"
    say "  nothing there. Start it when you drive a run: ddev start"
  else
    say "status '${CP_STATUS}' — starting"
    start_ddev "${ROOT}" "${CP_NAME}"
  fi
fi

# THE GUARD, here and before anything is created or written. This checkout's own
# .bakers/bakers.config.js hardcodes a dev2 base URL, so the wrong-control-plane
# hazard applies to this script's own commands and not only to the config it
# generates. A skill test that creates real tickets on dev2 or prod is worse than
# no test. The host check is what does the work: an equality check against a value
# read from a config would happily pass when that value is itself remote.
is_local_ddev_host "${BASE_URL}" \
  || die "refusing to run: the resolved control plane '${RAW_URL}' is not a local
       DDEV site (its host must end in '.ddev.site'). No entity was created."
say "${CP_NAME} at ${BASE_URL}"

# -----------------------------------------------------------------------------
step "2. the recipe-test world"
# -----------------------------------------------------------------------------
# Keyed on the project existing, not on a marker file — a marker survives a wiped
# database. Provisioned only when absent: it is slow, and it would wipe a world the
# operator may be mid-run against.
#
# THE LOAD-BEARING EXCLUSION OF `--workspace-only`. A worktree that
# `ddev init-worktree` has just provisioned carries the default `existing-config`
# world, in which the project does NOT exist — so the probe below would take its
# "not found" branch and run `ddev init --provider recipe-test`, wiping the database
# the bootstrap had just built and replacing the developer's branch site with the
# e2e world. Nobody asked for that and re-running nothing recovers it. So the whole
# step is skipped rather than made conditional on a guess about which world is live.
if [ "${WORKSPACE_ONLY}" = 'yes' ]; then
  say "--workspace-only: skipped (this mode provisions no world and writes no"
  say "  control plane — see the header for why this exclusion is the important one)"
else
  ensure_drush

  if ( cd "${ROOT}" && ddev drush status --field=bootstrap 2>/dev/null | grep -qi 'successful' ); then
    world_probe="$(cp_drush php:eval "
    \$ids = \\Drupal::entityTypeManager()
      ->getStorage('bb_project')->getQuery()->accessCheck(FALSE)
      ->condition('name', '${Q_PROJECT}')->execute();
    print (\$ids ? 'yes' : 'no') . PHP_EOL;
" | tail -1 | tr -d '[:space:]')"
    if [ "${world_probe}" = 'yes' ]; then
      say "'${PROJECT}' already provisioned — skipping ddev init"
    else
      say "project '${PROJECT}' not found — provisioning with the recipe-test provider"
      ( cd "${ROOT}" && ddev init --provider recipe-test )
    fi
  else
    say "Drupal is not bootstrapped — provisioning with the recipe-test provider"
    ( cd "${ROOT}" && ddev init --provider recipe-test )
    say "'${PROJECT}' provisioned"
  fi

  # The consumer secret. See CLIENT_SECRET above for why this is written rather than
  # read. Every value interpolated into a PHP snippet is the pre-escaped `Q_` form —
  # see php_str.
  cp_drush php:eval "
  \$s = \\Drupal::entityTypeManager()->getStorage('consumer')
    ->loadByProperties(['client_id' => '${Q_CLIENT_ID}']);
  \$c = reset(\$s);
  if (!\$c) { throw new \\RuntimeException('consumer ${Q_CLIENT_ID} is missing — is the recipe-test world provisioned?'); }
  \$c->set('secret', '${Q_CLIENT_SECRET}'); \$c->save();
" >/dev/null
  say "consumer '${CLIENT_ID}' carries the harness secret"
fi


# -----------------------------------------------------------------------------
step "3. the work workspace — clone the fixture repo"
# -----------------------------------------------------------------------------
if [ -z "${FIXTURE_REPO}" ]; then
  FIXTURE_REPO="${WORKSPACE}.git"
  seed_fixture_origin "${ROOT}/${FIXTURE_TREE_RELPATH}" "${FIXTURE_REPO}"
fi
say "fixture origin: ${FIXTURE_REPO}"
if [ -d "${WORKSPACE}/.git" ]; then
  if [ "$(git -C "${WORKSPACE}" remote get-url origin)" != "${FIXTURE_REPO}" ]; then
    git -C "${WORKSPACE}" remote set-url origin "${FIXTURE_REPO}"
    say "origin of ${WORKSPACE} now points at ${FIXTURE_REPO}"
  fi
  say "clone exists at ${WORKSPACE} — fetching"
  git -C "${WORKSPACE}" fetch --all --prune
else
  git clone --branch "${FIXTURE_BRANCH}" "${FIXTURE_REPO}" "${WORKSPACE}"
fi
SOURCE_BRANCH="$(git -C "$ROOT" branch --show-current)"
PARENT_BRANCH=''
if ! workspace_has_branch "$WORKSPACE" "$(test_branch_name "$SOURCE_BRANCH")"; then
  PARENT_BRANCH="$(cd "$ROOT" && parent_branch_for "$SOURCE_BRANCH")"
fi
select_workspace_branch "$WORKSPACE" "$SOURCE_BRANCH" "$PARENT_BRANCH"

# Keep every generated path out of `git status`, so nothing this script writes can
# be committed or even offered for commit. The list below is now entirely UNTRACKED
# by the fixture repo, so `.git/info/exclude` carries all of it. The `--skip-worktree`
# branch is kept for safety — `exclude` has no effect on a tracked path — but nothing
# reaches it any more, and that is the point rather than an accident: a tracked file
# hidden this way is a file whose every edit git stops showing.
#
# TWO files are deliberately ABSENT from the list, for the same reason:
#
#   - `WORKFLOW.md` — committed and hand-maintained; hiding it would make every edit
#     to the project's skill selection invisible to git.
#   - `.bakers/conductor.config.js` — likewise, since this script stopped generating it
#     (see step 7). It used to be generated AND hidden, and the pair cost a real run:
#     the fixture's committed hook was fixed, the fix was correct, and the next setup
#     run silently overwrote it — `skip-worktree` suppressing exactly the `git status`
#     line that would have shown the loss.
#
# `.bakers/log.txt` and `.bakers-worktrees/` are listed because the conductor's
# checkoutRoot is the DIRECTORY OF ITS CONFIG, i.e. `<clone>/.bakers` — so its log
# lands inside the clone's working tree and its per-ticket worktrees at
# `<clone>/.bakers-worktrees/<branch>`.
hide_from_git() {
  local exclude="${WORKSPACE}/.git/info/exclude" path
  mkdir -p "$(dirname "${exclude}")"
  for path in "$@"; do
    if git -C "${WORKSPACE}" ls-files --error-unmatch "${path}" >/dev/null 2>&1; then
      git -C "${WORKSPACE}" update-index --skip-worktree "${path}"
      say "skip-worktree: ${path} (tracked by the fixture repo)"
    else
      grep -qxF "${path}" "${exclude}" 2>/dev/null || echo "${path}" >>"${exclude}"
    fi
  done
}
hide_from_git \
  '.bakers/bakers.config.js' \
  '.bakers/conductor.config.local.js' \
  '.bakers/log.txt' \
  '.bakers-worktrees/' \
  '.ddev/config.worktree.yaml' \
  '.bakers-testbuild' \
  'node_modules/' \
  '.claude/skills'

# Heal a clone set up by an EARLIER revision of this script. Dropping a path from the
# list above does not clear a `--skip-worktree` bit an earlier run already set, so an
# existing clone would keep hiding the file — and the committed config that is now the
# single source would stay invisible in `git status`. Unset it explicitly; harmless
# when the bit was never set.
unhide_from_git() {
  local path
  for path in "$@"; do
    git -C "${WORKSPACE}" ls-files --error-unmatch "${path}" >/dev/null 2>&1 || continue
    case "$(git -C "${WORKSPACE}" ls-files -v "${path}")" in
      [a-z]*)
        git -C "${WORKSPACE}" update-index --no-skip-worktree "${path}"
        say "no-skip-worktree: ${path} (now hand-maintained in the fixture repo)"
        ;;
    esac
  done
}
unhide_from_git '.bakers/conductor.config.js' 'WORKFLOW.md' '.claude/settings.json'

# -----------------------------------------------------------------------------
step "4. the workspace's own DDEV"
# -----------------------------------------------------------------------------
# The name is derived from the workspace's absolute PATH, and that is load-bearing:
# the workspace lives inside the checkout and every bakers worktree has its own, so a
# name derived from anything the clone itself carries (its committed `name:`, its
# branch) would be identical across checkouts and two setups would fight over one
# DDEV project. See fact 4 for why `ddev init-worktree` is not used here.
WS_DDEV="bakers-pg-$(printf '%s' "${WORKSPACE}" | sha1sum | cut -c1-8)"
mkdir -p "${WORKSPACE}/.ddev"
cat >"${WORKSPACE}/.ddev/config.worktree.yaml" <<YAML
# GENERATED by scripts/setup-test-project.sh — git-ignored, never committed.
# A DDEV overlay carrying only the key that must differ per checkout. DDEV deep-
# merges every .ddev/config.*.yaml over config.yaml, so the committed
# type/php_version/docroot of the fixture repo all survive.
name: ${WS_DDEV}
YAML
# DECLARED, NOT STARTED (BB-390). The workspace runs no Drupal of its own; its
# DDEV exists purely so a skill under test can issue a real `ddev` command, which in
# practice it never does. Writing the overlay costs nothing and is the only thing
# giving the workspace a DDEV name that is unique per checkout, so it stays; the
# `ddev start` is what this script stopped paying for on every setup and on every
# `ddev init-worktree`. Start it by hand if a run needs it:
#   cd ${WORKSPACE_RELPATH} && ddev start
say "${WORKSPACE} (ddev project '${WS_DDEV}' declared, NOT started)"
say "  start it only if a skill under test needs it: cd ${WORKSPACE_RELPATH} && ddev start"

# -----------------------------------------------------------------------------
step "5. join the two — tell the control plane which branch the clone works on"
# -----------------------------------------------------------------------------
# Use the selected branch. origin/HEAD names the remote default rather than the
# current-ticket or parent workflow under test.
WS_URL="$(git -C "${WORKSPACE}" remote get-url origin)"
WS_BRANCH="$(git -C "${WORKSPACE}" branch --show-current)"
[ -n "$WS_BRANCH" ] || die "the workspace clone is detached; select a test branch first"

# Only the FIRST entry is compared, because that is all `BaseBranchItemList` reads:
# it returns the first repo with a non-empty `default_branch`. A second entry can
# never change the computed base_branch, so rewriting the list on account of one
# would be a write with no effect on the thing this exists to fix.
# `chr(9)`, never '\t': PHP single-quoted strings interpret NO escapes, so '\t'
# would be the two literal characters and the comparison below could never match —
# which showed up as setup rewriting an already-correct repo entry on every run.
# A git remote URL and a branch name are the two values here this script cannot
# constrain the way it constrains --project, so they are the reason php_str exists:
# `git checkout -b "it's"` is legal.
Q_WS_URL="$(php_str "${WS_URL}")"
Q_WS_BRANCH="$(php_str "${WS_BRANCH}")"

# READING the clone's branch above is a local git read and always runs — the summary
# reports it, and `--workspace-only` still wants it reported. What that mode skips is
# THE WRITE: the project repo entry is control-plane state a hand-driven run sets up
# once, and `ddev init-worktree` has no business touching the world on every worktree
# it creates.
if [ "${WORKSPACE_ONLY}" = 'yes' ]; then
  say "--workspace-only: the clone works on '${WS_BRANCH}'; the project repo entry is"
  say "  NOT written (run 'scripts/setup-test-project.sh' without the flag for that)"
else
  repo_state="$(cp_drush php:eval "
  \$p = \\Drupal::entityTypeManager()
    ->getStorage('bb_project')->loadByProperties(['name' => '${Q_PROJECT}']);
  \$p = reset(\$p);
  if (!\$p) { throw new \\RuntimeException('no bb_project named ${Q_PROJECT}'); }
  \$first = \$p->get('repository')->first();
  print (\$first ? ((string) \$first->url . chr(9) . (string) \$first->default_branch) : '') . PHP_EOL;
" 2>/dev/null | tail -1)"

  if [ "${repo_state}" = "${WS_URL}"$'\t'"${WS_BRANCH}" ]; then
    say "the project's first repo is already ${WS_URL} @ '${WS_BRANCH}'"
  else
    say "writing ${WS_URL} @ '${WS_BRANCH}' (was: ${repo_state:-<no repo entry, so base_branch fell back to main>})"
    cp_drush php:eval "
    \$p = \\Drupal::entityTypeManager()
      ->getStorage('bb_project')->loadByProperties(['name' => '${Q_PROJECT}']);
    \$p = reset(\$p);
    \$p->set('repository', [['url' => '${Q_WS_URL}', 'default_branch' => '${Q_WS_BRANCH}']]);
    \$p->save();
" >/dev/null
  fi
fi

# -----------------------------------------------------------------------------
step "6. make this checkout's CLI and this branch's skills resolvable there"
# -----------------------------------------------------------------------------
# Node resolves bare specifiers from <clone>/node_modules upward, so plain symlinks
# suffice (the clone needs no package.json) — but each linked package must actually
# be built. Still no `npm link` and no PATH change: a bare `bakers` in the workspace
# reaches this checkout's build through the `.bakers-testbuild` marker written at the
# end of this step (fact 5), which is scoped to the workspace and needs no global
# mutation to say so.
BB_CLI="${ROOT}/bakers-cli"
assert_built() {
  [ -f "$1" ] || die "$2 is not built ($1 missing) — run 'pnpm -r run build' in bakers-cli/ first"
}

# A build that EXISTS but predates its source is the worse of the two failures, and
# asking only "does the file exist" cannot see it. The whole point of linking this
# checkout's build into the workspace is that the run exercises THIS branch; a stale
# one silently runs different code, and a green skill test then says nothing about
# the commit. Found by running this script for real: the local conductor build was a
# day old and still carried the pre-BB-232 `stop` that closed a herdr workspace, so
# a live observation contradicted the source that lands.
#
# Fatal rather than a warning: a warning in this much output is a warning nobody
# reads, and the cost of being wrong is a test whose result is about the wrong code.
assert_current() {
  local newer
  newer="$(find "$1" -name '*.ts' -newer "$2" -print -quit 2>/dev/null || true)"
  [ -z "${newer}" ] || die "$3 is STALE: ${newer#"${ROOT}"/} is newer than its build.
       The workspace would run a different CLI than this branch's source, so a green
       skill test would be about the wrong code. Rebuild first:
         cd ${BB_CLI} && pnpm -r run build"
}
# The packages the workspace links, as `<src dir>|<dist entry>|<label>`. ONE list,
# read twice — once to decide whether a build is needed and once to assert the
# result — because two hand-maintained lists drift and the drift is silent. core is
# in it like the rest: an unbuilt kernel fails at import time in the workspace,
# which reads as a config problem.
BUILD_UNITS=(
  "${BB_CLI}/host/src|${BB_CLI}/host/dist/src/host.js|the bakers host"
  "${BB_CLI}/conductor/src|${BB_CLI}/conductor/dist/src/index.js|the conductor"
  "${BB_CLI}/core/src|${BB_CLI}/core/dist/src/index.js|the bakers core"
)
for addon in herdr claude codex remote-drupal essentials ports; do
  BUILD_UNITS+=("${BB_CLI}/addons/${addon}/src|${BB_CLI}/addons/${addon}/dist/src/index.js|the ${addon} addon")
done

# BUILD WHEN NEEDED (BB-390). The assertions below used to be the whole of this
# step, which made a missing or stale build a STOP SIGN where an action was
# available: every worktree had to be built by hand (or by an unconditional build in
# `ddev init-worktree`, paid for whether or not the ticket touches the CLI) before
# this script would run at all. So the same probe now triggers the build instead of
# refusing. What does NOT change is that a build which FAILS is fatal, and that the
# assertions still run afterwards — they are what keeps a green skill test from being
# about the wrong code, and a build can succeed without producing what is linked.
needs_build=''
for unit in "${BUILD_UNITS[@]}"; do
  unit_rest="${unit#*|}"
  unit_src="${unit%%|*}"
  unit_dist="${unit_rest%%|*}"
  unit_label="${unit_rest#*|}"
  if [ ! -f "${unit_dist}" ]; then
    needs_build="${unit_label} is not built"
    break
  fi
  if [ -n "$(find "${unit_src}" -name '*.ts' -newer "${unit_dist}" -print -quit 2>/dev/null || true)" ]; then
    needs_build="${unit_label} is older than its own sources"
    break
  fi
done
if [ -n "${needs_build}" ]; then
  say "${needs_build} — building the CLI first"
  # --config.minimumReleaseAge=0 dodges the workspace supply-chain deps-verify policy
  # that fails a plain install on a fresh tree; `pnpm -r run build` is each package's
  # own tsc (the monorepo has no root solution tsconfig, so a bare tsc resolves
  # nothing).
  ( cd "${BB_CLI}" && pnpm install --config.minimumReleaseAge=0 && pnpm -r run build ) \
    || die "the bakers CLI build failed in ${BB_CLI}. This is fatal on purpose: the
       workspace links THIS build, so continuing would wire up a workspace that either
       cannot import the CLI or runs an older one. Fix the build and re-run."
  say "built"
else
  say "the linked packages are built and current — nothing to build"
fi

for unit in "${BUILD_UNITS[@]}"; do
  unit_rest="${unit#*|}"
  unit_src="${unit%%|*}"
  unit_dist="${unit_rest%%|*}"
  unit_label="${unit_rest#*|}"
  assert_built "${unit_dist}" "${unit_label}"
  assert_current "${unit_src}" "${unit_dist}" "${unit_label}"
done
[ -x "${BB_BIN}" ] || die "the checkout's bakers CLI is missing at ${BB_BIN}"

mkdir -p "${WORKSPACE}/node_modules/@bakers-build"
for addon in herdr claude codex remote-drupal essentials ports; do
  ln -sfn "${BB_CLI}/addons/${addon}" "${WORKSPACE}/node_modules/@bakers-build/addon-${addon}"
done
ln -sfn "${BB_CLI}/conductor" "${WORKSPACE}/node_modules/@bakers-build/conductor"
ln -sfn "${BB_CLI}/core" "${WORKSPACE}/node_modules/@bakers-build/core"
# The dropsh auth plugin the generated connection config names. Not a @bakers-ai
# package, so it resolves from the workspace root's node_modules.
if [ -d "${BB_CLI}/node_modules/@dropsh/plugin-oauth2" ]; then
  mkdir -p "${WORKSPACE}/node_modules/@dropsh"
  ln -sfn "${BB_CLI}/node_modules/@dropsh/plugin-oauth2" \
    "${WORKSPACE}/node_modules/@dropsh/plugin-oauth2"
fi
# Put THIS branch's skill sources in front of the agent. Two things are needed, and
# each was measured — an earlier revision did only half of the first and silently
# loaded the main checkout's skills instead. Only the FIRST is generated here:
#
#  1. LINK THE FLAT SKILL DIRECTORY, NOT THE BUNDLE. `<root>/.claude/skills/bakers-build` is
#     a plugin BUNDLE (`.claude-plugin/`, `skills/`, `templates/`) and carries no
#     `SKILL.md`. Claude Code loads `<project>/.claude/skills/<name>/SKILL.md`, so
#     linking the bundle puts a directory there that matches nothing and loads zero
#     skills. The real skills are one level deeper, in `.../bakers/skills/`. Generated
#     because the link target is this checkout's absolute path.
#  2. DISABLE THE GLOBAL `bakers` PLUGIN FOR THIS PROJECT — the user's own
#     `~/.claude/settings.json` may enable `bakers@bakers` from a marketplace pinned to a
#     FIXED path (typically the main checkout), and that plugin wins over anything a
#     project links or re-registers; re-declaring the marketplace project-locally was
#     measured and does NOT override it. That is now the fixture's COMMITTED
#     `.claude/settings.json` and is no longer written here: the value is byte-identical
#     on every machine, and this script generates only what changes with the host. A
#     ticket worktree gets it from its own checkout, so the `after_create` hook does not
#     copy it either.
#
# Keep that split when adding anything: host-dependent → generated and hidden from git;
# constant → committed in the fixture, where it is reviewable and survives a fresh clone.
mkdir -p "${WORKSPACE}/.claude"
ln -sfn "${ROOT}/.claude/skills/bakers-build/skills" "${WORKSPACE}/.claude/skills"
say "linked @bakers-build/{addon-herdr,addon-claude,addon-codex,addon-remote-drupal,addon-essentials,addon-ports,conductor,core}"
say ".claude/skills linked in the clone root → $(readlink -f "${WORKSPACE}/.claude/skills")"

# THE LINK ABOVE ONLY REACHES A CLAUDE-FAMILY AGENT, and saying so is the point.
# `.claude/skills` is a project-local directory that Claude Code reads. Codex does
# not read it: its skills are GLOBAL, resolved from `~/.codex/skills/<name>`
# (installed through the marketplaces in `~/.codex/config.toml`), with no
# project-local equivalent to override them. So a Codex dispatch out of this
# workspace loads whatever is installed on the machine and NOT this branch —
# silently, and with a perfectly normal-looking run to show for it.
#
# Measured on BB-525: a Codex dispatch loaded
# `~/.codex/skills/bakers-method-context → ~/.agents/skills/method-context`, a copy
# with none of the branch's changes, and the run "passed" without ever touching
# the code under test. That is the worst failure a test harness can have, so it is
# reported here rather than left to be discovered per ticket.
if [ -d "${HOME}/.codex/skills" ]; then
  say "WARNING: this machine has global Codex skills in ~/.codex/skills."
  say "  Codex ignores the .claude/skills link above and loads THOSE instead, so a"
  say "  Codex dispatch tests the installed skills, not this branch. Dispatch with a"
  say "  Claude-family agent when the skills themselves are what is under test."
fi

# THE MARKER (BB-390). One line, one absolute path, nothing else: the shim READS it
# with `head -n1` rather than sourcing it, because sourcing a file to obtain one
# string would be arbitrary code execution in every `bakers` invocation on the machine.
# `~/.local/bin/bakers` walks up the FILESYSTEM from the physical working directory
# looking for this file — up, so it is also found from the conductor's per-ticket
# worktrees at `<workspace>/.bakers-worktrees/<branch>`, which a git-based lookup could
# never see past; filesystem, so a workspace reached through a symlink still matches.
# It is in `hide_from_git` above, so it never reaches the fixture clone's git status.
printf '%s\n' "${ROOT}" >"${WORKSPACE}/.bakers-testbuild"
say "wrote .bakers-testbuild → ${ROOT} (a bare 'bakers' in the workspace is now THIS build)"

# -----------------------------------------------------------------------------
step "7. generate the two machine-local files — neither of them committed"
# -----------------------------------------------------------------------------
# `machine_id` is REQUIRED (an engine config missing it fails to load) and is
# composed exactly as `bakers conductor init` composes it:
# ${user_id}-${machine_id}-${project} from ~/.bakers/machine.config.js. The context is
# IMPORTED rather than pattern-matched, because that is what the CLI itself does and
# a regex over a JS module hits comments and nested keys. Only these two fields are
# read; the context's own base_url is a REMOTE control plane and is deliberately
# ignored.
machine_identity="$(MC="${HOME}/.bakers/machine.config.js" node -e '
  const p = process.env.MC;
  import("node:fs").then(async (fs) => {
    if (!fs.existsSync(p)) return process.stdout.write("\t");
    try {
      const d = (await import("file://" + p)).default ?? {};
      process.stdout.write(`${d.user_id ?? ""}\t${d.machine_id ?? ""}`);
    } catch { process.stdout.write("\t"); }
  });' 2>/dev/null || printf '\t')"
MACHINE_USER="$(printf '%s' "${machine_identity}" | cut -f1)"
MACHINE_HOST="$(printf '%s' "${machine_identity}" | cut -f2)"
[ -n "${MACHINE_HOST}" ] || MACHINE_HOST="${CP_NAME}"
if [ -n "${MACHINE_USER}" ]; then
  MACHINE_ID="${MACHINE_USER}-${MACHINE_HOST}-${PROJECT}"
else
  MACHINE_ID="${MACHINE_HOST}-${PROJECT}"
fi

mkdir -p "${WORKSPACE}/.bakers"

# The CONNECTION config. Modelled on the checkout's own but with LITERAL values:
# generated per run, so it inherits nothing from the machine context and pins the
# control plane it was generated for.
#
# ONE profile over ONE credentialled identity, on ONE scope (BB-391). There
# used to be two profiles — `session` and `pm` — over this same single consumer,
# differing only by the scope they requested. That choice at every call site is
# what went away; the scope itself did not, and the difference matters here:
# `simple_oauth`'s Oauth2AccessPolicy overwrites a client_credentials token's
# permissions with EXACTLY the scope's, so `bb:session` IS this identity's
# capability. Requesting none would mint no token at all against a consumer with
# no default scopes, and silently inherit that default when there is one.
cat >"${WORKSPACE}/.bakers/bakers.config.js" <<JS
// GENERATED by scripts/setup-test-project.sh — do not commit
// @bakers-schema-version 3
// The CONNECTION surface (BB-201): a dropsh-shaped { site, plugins } read by
// 'bakers ui', 'bakers dropsh', and the conductor's auth.
//
// plugins[] is consumed by DROPSH, whose resolver has no sole-function auto-pick,
// so @dropsh/plugin-oauth2 entries MUST name export: 'oauth2Plugin'.
export default {
  schema_version: 3,
  site: { base_url: '${BASE_URL}', jsonapi_prefix: '/jsonapi' },
  // BB-495: OPTIONAL and top-level — a sibling of \`site\`, never a member of it
  // and never an addon's \`with\`. It is \`bakers ui\`-facing only: the UI attaches
  // @bakers-build/addon-workspace itself at startup so its picker starts focused and
  // its lists are scoped by construction. \`bakers dropsh\` reads nothing here — the
  // caller names the workspace on each call (\`--workspace_id …\`), and the server
  // refuses an unbound or cross-tenant write either way. It is written here
  // because the playground exists to drive \`bakers ui\`.
  workspace_id: '${WORKSPACE_ID}',
  plugins: [
    { plugin: '@bakers-build/addon-essentials' },
    {
      plugin: '@dropsh/plugin-oauth2',
      export: 'oauth2Plugin',
      with: {
        id: '${OAUTH_PROVIDER_ID}',
        default: true,
        type: 'oauth2_client_credentials',
        client_id: '${CLIENT_ID}',
        client_secret: '${CLIENT_SECRET}',
        token_url: '${BASE_URL}/oauth/token',
        scope: '${OAUTH_SCOPE}',
      },
    },
  ],
};
JS

# The ENGINE config is NOT generated. `.bakers/conductor.config.js` is a COMMITTED,
# hand-maintained file of the fixture repo — the same decision already taken for
# `WORKFLOW.md`, for the same reason and after the same failure.
#
# Generating it meant two authors for one path: the clone brought the committed file,
# this script overwrote it, and `--skip-worktree` hid the difference from `git status`.
# The two drifted, and a correct fix committed to the fixture repo was silently
# discarded by the next setup run. Which version was live depended on nothing but when
# the script last ran. So the engine surface — addons, the `after_create` hook, the
# state slice — now lives in the fixture repo alone, is reviewable in its own history,
# and survives every run of this script.
#
# WHAT IS STILL GENERATED IS THE MACHINE OVERRIDE, and it is the reason the split
# works: the committed config reads `project` and `machine_id` from
# `.bakers/conductor.config.local.js` (`local.project ?? …`, `local.machine_id`), and
# `machine_id` is REQUIRED — an engine config missing it fails to load. Those two are
# the only values that cannot be committed, because they identify THIS machine and the
# control plane this run provisioned. Everything structural stays in the fixture repo;
# only the per-machine identity is written here. The file is untracked and already
# listed in `hide_from_git`.
cat >"${WORKSPACE}/.bakers/conductor.config.local.js" <<JS
// GENERATED by scripts/setup-test-project.sh — do not commit
// The per-machine override the committed .bakers/conductor.config.js reads. It carries
// ONLY the two values that identify this machine's run; addons, hooks and the state
// slice belong to the committed config and are deliberately absent here.
export default {
  project: '${PROJECT}',
  machine_id: '${MACHINE_ID}',
};
JS

# The project skill loader is NOT generated here. `WORKFLOW.md` is a COMMITTED,
# hand-maintained file of the fixture repo: which skills the project loads is a
# property of the project, reviewable in its own history, and it must survive a
# fresh clone. Generating it meant every edit was invisible to git and lost on the
# next run, and it forced the `after_create` hook to copy the clone's working-tree
# copy into each ticket worktree — a worktree cut from `origin/<base_branch>` now
# simply checks the file out.
#
# One trap that costs real runs, kept here because the file this script no longer
# writes still has to satisfy it: a hint section is read only under its exact phase
# name (`provision`, `work`, `validate`, `deliver`). A `## Checks` table is never read,
# so a run reports no project check at all.
say "generated .bakers/bakers.config.js and .bakers/conductor.config.local.js"
say "machine_id: ${MACHINE_ID}"
say ".bakers/conductor.config.js is COMMITTED in the fixture repo — not written here"
say "  → its addons, after_create hook and state slice are reviewed in that repo"

# -----------------------------------------------------------------------------
# `--workspace-only` ENDS HERE. Steps 8 and 9 are the two remaining control-plane
# actions — repairing the OAuth2 keys and minting a session token — and both belong
# to a hand-driven run that is about to drive a conductor. `ddev init-worktree`
# creates worktrees; it has no business logging a profile in on every one of them.
# The closing text is its own, because the three next steps printed below assume the
# repo entry and the session this mode deliberately did not create.
if [ "${WORKSPACE_ONLY}" = 'yes' ]; then
  step "8. + 9. OAuth2 keys and session token — SKIPPED (--workspace-only)"
  cat <<WS_SUMMARY

=============================================================================
workspace ready (--workspace-only)

  control plane   ${CP_NAME} at ${BASE_URL}   (described, not provisioned)
  workspace       ${WORKSPACE}
  workspace ddev  ${WS_DDEV}   (declared, NOT started)
  base branch     ${WS_BRANCH}   (read from the clone; not written to the world)
  machine_id      ${MACHINE_ID}
  bakers binary     a bare 'bakers' inside the workspace IS this checkout's build,
                  via ${WORKSPACE_RELPATH}/.bakers-testbuild

To drive a real run from here, provision the world and mint a session — that is the
same script without the flag:

  scripts/setup-test-project.sh${PROJECT:+ --project ${PROJECT}}

When you are done: scripts/teardown-test-project.sh
=============================================================================
WS_SUMMARY
  exit 0
fi

# -----------------------------------------------------------------------------
step "8. repair the OAuth2 keys if the environment destroyed them"
# -----------------------------------------------------------------------------
# See fact 3. Probed FROM INSIDE THE CONTAINER, as Drupal: `file_exists`/
# `is_readable` evaluated by the same PHP process that will read the key on every
# token mint. A host-side `ls` would answer a different question — the paths are
# container paths and one failure mode is ownership. `readable`, not merely
# `exists`: a key that survived with the wrong owner fails in the same HTTP 500.
# `chr(9)`, never '\t' — see step 5. Getting this wrong read a perfectly healthy
# control plane as having two unusable keys and no configured directory, and then
# refused to continue.
# stderr is CAPTURED rather than discarded: a drush failure here is a real outcome
# and its own words are the only useful thing to print. Discarding them, and then
# collapsing the failure with `|| true`, is what let an unrun probe read as "the
# keys are usable".
if ! key_probe="$(cp_drush php:eval "
  \$c = \\Drupal::config('simple_oauth.settings');
  foreach (['public_key', 'private_key'] as \$k) {
    \$p = (string) \$c->get(\$k);
    print \$k . chr(9) . \$p . chr(9) . ((\$p !== '' && file_exists(\$p) && is_readable(\$p)) ? 'ok' : 'bad') . PHP_EOL;
  }
" 2>&1)"; then
  die "the OAuth2 key probe could not run against ${CP_NAME}:
${key_probe}"
fi

# The grep may legitimately match nothing; parse_key_probe is what turns that into
# a named failure, so `|| true` is correct HERE and was not correct above. It is
# braced because `a || true | b` would parse as `a || (true | b)` and quietly feed
# the parser nothing at all.
parsed="$(printf '%s\n' "${key_probe}" \
  | { grep -E '^(public|private)_key' || true; } \
  | parse_key_probe)"
KEY_DIR="${parsed%%$'\t'*}"
keys_ok="${parsed##*$'\t'}"

if [ "${keys_ok}" = 'ok' ]; then
  say "usable in ${KEY_DIR} — nothing to do"
else
  # One generate call cannot satisfy two directories, and a key with no configured
  # path names no directory to generate into. Reported instead of guessed.
  [ -n "${KEY_DIR}" ] && [ "${KEY_DIR}" != 'MIXED' ] \
    || die "the OAuth2 keys need regenerating but simple_oauth.settings does not name
       one shared directory for both — fix the config before re-running"
  say "regenerating in ${KEY_DIR}"
  # sudo, because the directory is root-owned when the container recreates it, and
  # `simple-oauth:generate-keys` cannot create its own writable home. NUMERIC ids
  # taken from the host process: DDEV maps the web user onto the host uid/gid, so
  # these are the same identity inside the container — and a number needs no name
  # to exist there, which `www-data` does not reliably.
  ( cd "${ROOT}" && ddev exec sudo mkdir -p "${KEY_DIR}" )
  ( cd "${ROOT}" && ddev exec sudo chown -R "$(id -u):$(id -g)" "${KEY_DIR}" )
  cp_drush simple-oauth:generate-keys "${KEY_DIR}" >/dev/null
  recheck="$(cp_drush php:eval "
    \$c = \\Drupal::config('simple_oauth.settings');
    \$bad = 0;
    foreach (['public_key', 'private_key'] as \$k) {
      \$p = (string) \$c->get(\$k);
      if (\$p === '' || !file_exists(\$p) || !is_readable(\$p)) { \$bad++; }
    }
    print \$bad . PHP_EOL;
" 2>/dev/null | tail -1 | tr -d '[:space:]')"
  [ "${recheck}" = '0' ] \
    || die "the OAuth2 keys are still unusable after regenerating in ${KEY_DIR}"
  say "regenerated and readable"
fi

# -----------------------------------------------------------------------------
step "9. mint the token"
# -----------------------------------------------------------------------------
# Required, not optional: without a stored session every conductor command in the
# workspace dies with "Not authenticated for profile '${OAUTH_PROVIDER_ID}'".
# Non-interactive because the generated connection config carries the
# client_secret. The token is cached per host (~/.config/dropsh/<host>.json), so
# it cannot collide with the operator's real control planes.
#
# BB-391: `--provider` names the connection's ONE provider — it is not a
# capability choice, and there is no second profile to switch to.
( cd "${WORKSPACE}" && "${BB_BIN}" dropsh auth login --provider "${OAUTH_PROVIDER_ID}" )
say "${OAUTH_PROVIDER_ID} provider logged in against ${BASE_URL}"

# -----------------------------------------------------------------------------
cat <<SUMMARY

=============================================================================
setup complete

  control plane   ${CP_NAME} at ${BASE_URL}
  world project   ${PROJECT}
  workspace       ${WORKSPACE}
  workspace ddev  ${WS_DDEV}  (declared, NOT started — 'cd ${WORKSPACE_RELPATH} && ddev start')
  base branch     ${WS_BRANCH}  (every per-ticket worktree is cut from this)
  machine_id      ${MACHINE_ID}
  bakers binary     a bare 'bakers' in the workspace IS this checkout's build, because
                  ${WORKSPACE_RELPATH}/.bakers-testbuild names it (BB-390)

The ticket is yours. Three steps, and the last one spends real agent money.

  Create a representative docs ticket after reading the fixture's committed
  WORKFLOW.md. Assignment uses the normal worker connection and ticket edit access.

  1. Register the conductor, because it has no record and therefore no uuid until
     it has run one cycle — so there is nothing to write in step 2 before this:

       cd ${WORKSPACE} && bakers oven once

  2. Create a chore ticket (recipe matt) in project '${PROJECT}' and set its conductor_id to
     the conductor carrying machine_id '${MACHINE_ID}'. The claim keys on that
     field, so without it nothing is ever claimed. Use the same connection as
     registration; no separate assignment permission or auth profile is needed.

       bakers dropsh --format md search bb_project --bundle bb_project --filter 'name:${PROJECT}'
       bakers dropsh --format md search bb_conductor --bundle bb_conductor --filter 'conductor_id:${MACHINE_ID}'
       bakers dropsh create bb_ticket --bundle bb_ticket --title 'Conductor verification' --workflow bb_work --type_names chore --recipe_names matt --project_id <project-uuid> --conductor_id <conductor-uuid>

     Substitute the UUIDs returned by the searches. Existing tickets can be assigned:

       bakers dropsh update bb_ticket/bb_ticket/<ticket-uuid> --conductor_id <conductor-uuid>

  3. Drive the run and WATCH it:

       cd ${WORKSPACE} && bakers oven start

     The agent works in ${WORKSPACE}/.bakers-worktrees/<branch>; the conductor's own
     log is at ${WORKSPACE}/.bakers/log.txt, which is a DIFFERENT log from
     bb_run.log and is where claims and dispatch failures appear. A state write
     is what retires a run server-side and auto-dispatches the next state's run, so
     a ticket that stops moving with no state change is the interesting case.

     To re-drive the SAME ticket, its bb_run rows must be DELETED, not released: a
     run whose state_at_start equals the ticket's current state blocks re-claiming
     even when it is released or terminal, and the symptom is a ticket that is
     silently never picked up again.

When you are done: scripts/teardown-test-project.sh
=============================================================================
SUMMARY
