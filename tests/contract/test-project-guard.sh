#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Behavioural contract for scripts/setup-test-project.sh and
# scripts/teardown-test-project.sh: their --help windows, the control-plane
# guard, value escaping, the key probe and the guarded deletes.
#
#   bash tests/contract/test-project-guard.sh
#
# CI runs it through bakers-cli/core/tests/workflow/repository-contracts.test.ts.
# Nothing needs a provisioned environment, a global CLI install or a built
# bakers-cli: the behavioural assertions run the scripts against a STUBBED `ddev`.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# --- The unit-test seam -----------------------------------------------------
#
# The node harness that held this ticket's unit tests moved to BB-286, so the
# pure functions of these two scripts would otherwise have no automated coverage
# at all. Rather than add a test-only entry point to production code, a function
# is LIFTED OUT of the script by name and evaluated in a subshell against stubbed
# `say`/`die`. What is tested is therefore the shipped source, byte for byte —
# there is no second copy to drift.
#
# `extract_fn` reads from `name() {` to the first line that is exactly `}`, which
# is the shape every function in both scripts has.
extract_fn() {
  awk -v fn="$2" '
    $0 ~ "^" fn "\\(\\) \\{" { inside = 1 }
    inside { print }
    inside && /^\}$/ { exit }
  ' "$1"
}

# Evaluate one lifted function and run a probe expression against it. Stubs are
# defined BEFORE the eval so a function that reports through them is testable
# without being rewritten for the test. Anything after the probe becomes the
# subshell's positional parameters, so a value carrying quotes or backslashes is
# handed over as data instead of being re-quoted into the probe source.
with_fn() {
  local script="$1" fn="$2" probe="$3" body
  shift 3
  body="$(extract_fn "${script}" "${fn}")"
  [ -n "${body}" ] || fail "cannot lift '${fn}()' out of ${script#"$ROOT"/}"
  (
    set -uo pipefail
    # The stubs MIRROR the real definitions, `say` writing to stdout included. A
    # silencing stub looks tidier and is a trap: a lifted function whose own stdout
    # is captured by its caller must not `say`, and a stub that swallows it hides
    # exactly that defect. This one was written silent first, and a live run then
    # found the bug the silence had covered.
    say() { echo "   $*"; }
    step() { echo; echo "== $*"; }
    die() { echo "DIED: $*" >&2; exit 1; }
    eval "${body}"
    eval "${probe}"
  )
}

# === 2. The surviving wiring: two shell scripts, and no harness ==============

SETUP="$ROOT/scripts/setup-test-project.sh"
TEARDOWN="$ROOT/scripts/teardown-test-project.sh"
[ -x "${SETUP}" ] || fail "scripts/setup-test-project.sh is missing or not executable"
[ -x "${TEARDOWN}" ] || fail "scripts/teardown-test-project.sh is missing or not executable"

setup_help="$(bash "${SETUP}" --help)" || fail "setup-test-project.sh --help failed"
teardown_help="$(bash "${TEARDOWN}" --help)" || fail "teardown-test-project.sh --help failed"

# Each names its counterpart, because an operator who found one must not have to
# guess that the other exists.
grep -q 'teardown-test-project.sh' <<<"${setup_help}" \
  || fail "setup --help does not name teardown-test-project.sh"
grep -q 'setup-test-project.sh' <<<"${teardown_help}" \
  || fail "teardown --help does not name setup-test-project.sh"

# THE SCOPE BOUNDARY IS ASSERTED, not just documented. `setup` brings the
# environment up and stops there: the ticket, the conductor registration and the
# run are the operator's, and the automated versions of all three are BB-286's.
# A script that silently grew a seed step would quietly re-import that scope.
grep -qi 'does NOT create a ticket' <<<"${setup_help}" \
  || fail "setup --help does not state that it creates no ticket"
grep -qi 'real agent money' <<<"${setup_help}" \
  || fail "setup --help does not say that driving the run costs real agent money"
# Teardown's two deliberate non-actions, likewise.
grep -qi 'CONTROL-PLANE DDEV' <<<"${teardown_help}" \
  || fail "teardown --help does not state that it leaves the control-plane DDEV alone"
grep -qi 'RECIPE FIXTURES' <<<"${teardown_help}" \
  || fail "teardown --help does not state that it keeps the world's recipe fixtures"
pass "the wiring is two documented scripts, and each names the other"

# The fixture must load this branch's skill sources, not a frozen marketplace copy. The project
# setting is machine-independent and therefore committed; setup generates only the host-dependent
# symlink. Keeping these roles separate makes the real Conductor run reproducible in a fresh clone.
SETTINGS="$ROOT/.claude/settings.json"
[ -f "$SETTINGS" ] || fail ".claude/settings.json does not commit the fixture plugin override"
jq -e '.enabledPlugins["bakers@bakers"] == false' "$SETTINGS" >/dev/null \
  || fail ".claude/settings.json does not disable the frozen bakers@bakers plugin"
if grep -qE '(printf|cat|echo).*[.]claude/settings[.]json|>[[:space:]]*.*[.]claude/settings[.]json' "$SETUP"; then
  fail "setup writes the machine-independent .claude/settings.json instead of using the fixture"
fi
grep -q 'ln -sfn .*\.claude/skills/bakers-build/skills' "$SETUP" \
  || fail "setup does not link the branch-local flat skill directory"
pass "the fixture commits its plugin override and setup links branch-local skills"

# === 3. The control-plane guard actually refuses =============================
#
# AC2 has no unit test any more — the node harness that held one is gone — so it is
# asserted HERE, and end to end rather than as a predicate: a stubbed `ddev` reports
# a REMOTE control plane, and `setup` must refuse before it calls `ddev` for
# anything else. The stub screams if it is called again, so this proves the guard's
# PLACEMENT and not merely its condition. No DDEV, no world and no network are
# involved.
STUB_DIR="$(mktemp -d)"
trap 'rm -rf "${STUB_DIR}"' EXIT
cat >"${STUB_DIR}/ddev" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = 'describe' ]; then
  echo '{"raw":{"name":"stub","status":"running","httpurl":"https://develop.dev.bakers.build"}}'
  exit 0
fi
echo "STUB-VIOLATION: 'ddev $*' was called after the guard should have refused" >&2
exit 99
STUB
chmod +x "${STUB_DIR}/ddev"

# `if`, not `cmd && fail`: whether `set -e` aborts on a failing left-hand side of an
# AND-list is exactly the kind of subtlety a gate must not depend on.
if guard_out="$(cd "$ROOT" && PATH="${STUB_DIR}:$PATH" bash scripts/setup-test-project.sh 2>&1)"; then
  fail "setup did NOT refuse a remote control plane"
fi
if grep -q 'STUB-VIOLATION' <<<"${guard_out}"; then
  fail "setup called ddev again after the guard should have refused"
fi
grep -q 'develop.dev.bakers.build' <<<"${guard_out}" \
  || fail "the refusal does not name the resolved control plane"
grep -q 'No entity was created' <<<"${guard_out}" \
  || fail "the refusal does not state that no entity was created"

# And the counter-direction, so the guard cannot be a blanket refusal: a local DDEV
# host must get PAST it. The stub then blocks the next ddev call, which is the proof
# the guard let the run continue.
sed -i 's|https://develop.dev.bakers.build|https://stub.ddev.site|' "${STUB_DIR}/ddev"
local_out="$(cd "$ROOT" && PATH="${STUB_DIR}:$PATH" bash scripts/setup-test-project.sh 2>&1 || true)"
grep -q 'http://stub.ddev.site' <<<"${local_out}" \
  || fail "setup refused a local .ddev.site control plane, which the guard must allow"
pass "the guard refuses a remote control plane before any write, and allows a local one"

# The guard's CONDITION, separately from its placement. The end-to-end leg above
# can only ever exercise the two URLs `ddev describe` actually produces, and the
# gate protecting prod from a test harness deserves its adversarial cases. These
# are the cases the deleted `guard.mjs` was unit-tested on, restored: a URL glob
# admits `http://remote.example.com/x.ddev.site`, because `*` matches `/` — so the
# host has to be parsed out before it is matched.
guard_says() { with_fn "${SETUP}" 'is_local_ddev_host' "is_local_ddev_host '$1' && echo yes || echo no"; }
for ok_url in \
  'http://bb-273.ddev.site' \
  'http://bb-273.ddev.site:8443' \
  'http://bb-273.ddev.site/'; do
  [ "$(guard_says "${ok_url}")" = 'yes' ] \
    || fail "is_local_ddev_host rejected the local DDEV URL '${ok_url}'"
done
for bad_url in \
  'http://develop.dev.bakers.build' \
  'http://develop.dev.bakers.build/x.ddev.site' \
  'http://develop.dev.bakers.build/?x=.ddev.site' \
  'http://evil.ddev.site.example.com' \
  'http://user@evil.example.com' \
  ''; do
  [ "$(guard_says "${bad_url}")" = 'no' ] \
    || fail "is_local_ddev_host ACCEPTED the non-local URL '${bad_url}'"
done
pass "the guard parses the host out rather than globbing the URL"

# === 4. Nothing unescaped reaches `drush php:eval` ==========================
#
# Commit 4d629ee9 closed this once, for the review finding that an apostrophe
# closed the PHP literal early so the container answered with a parse error
# instead of a named failure. The bash rewrite dropped the helper, and `--project`
# is operator input — so the finding is asserted here rather than trusted to
# survive the next rewrite.

# The helper itself. `\` first, then `'`: escaping in the other order would double
# the backslash the apostrophe escape introduces.
esc() { with_fn "${SETUP}" 'php_str' 'php_str "$1"' "$1"; }
[ "$(esc "o'brien")" = "o\\'brien" ] || fail "php_str does not escape an apostrophe"
[ "$(esc 'a\b')" = 'a\\b' ] || fail "php_str does not escape a backslash"
[ "$(esc 'plain-value')" = 'plain-value' ] || fail "php_str altered a plain value"
[ "$(esc "a\\'b")" = "a\\\\\\'b" ] || fail "php_str mis-orders backslash and quote escaping"
[ -z "$(esc '')" ] || fail "php_str did not pass an empty value through"

# `--project` is the one operator-supplied value, and it reaches THREE sinks: PHP,
# the generated JS engine config, and the composed machine_id. Rather than three
# escapers it is refused at the door — so the end-to-end assertion is that a name
# carrying a quote never becomes a command at all. A recording stub proves it: the
# door check runs before the first `ddev`, so the recording must stay EMPTY.
REC_DIR="$(mktemp -d)"
trap 'rm -rf "${STUB_DIR}" "${REC_DIR}"' EXIT
record_stub() {
  cat >"${REC_DIR}/ddev" <<STUB
#!/usr/bin/env bash
printf '%s\0' "\$@" >>'${REC_DIR}/argv'
if [ "\$1" = 'describe' ]; then
  echo '{"raw":{"name":"stub","status":"running","httpurl":"http://stub.ddev.site"}}'
  exit 0
fi
if [ "\$1" = 'drush' ] && [ "\$2" = '--version' ]; then
  exit 0
fi
if [ "\$1" = 'drush' ] && [ "\$2" = 'status' ]; then
  echo 'Successful'
  exit 0
fi
exit 99
STUB
  chmod +x "${REC_DIR}/ddev"
  rm -f "${REC_DIR}/argv"
}
recorded_argv() { tr '\0' '\n' <"${REC_DIR}/argv" 2>/dev/null || true; }

record_stub
if ( cd "$ROOT" && PATH="${REC_DIR}:$PATH" \
     bash scripts/setup-test-project.sh --project "o'brien" >/dev/null 2>&1 ); then
  fail "setup accepted a --project carrying a quote"
fi
[ ! -e "${REC_DIR}/argv" ] \
  || fail "setup ran a ddev command before refusing an unrepresentable --project"

# And the counter-direction, which is what makes the pair meaningful: a legal name
# DOES reach the first php:eval, and reaches it interpolated. Its own value is what
# is asserted — an escaper wired to the wrong variable name would otherwise emit an
# empty PHP literal and quietly probe for a project called ''.
record_stub
( cd "$ROOT" && PATH="${REC_DIR}:$PATH" \
  bash scripts/setup-test-project.sh --project 'bakers-e2e-project' >/dev/null 2>&1 ) || true
recorded="$(recorded_argv)"
grep -q 'php:eval' <<<"${recorded}" \
  || fail "the recording stub never saw a php:eval — setup's call order changed"
grep -qF "'bakers-e2e-project'" <<<"${recorded}" \
  || fail "the php:eval snippet carries no project literal — check the Q_ wiring"
pass "an unrepresentable --project is refused before any command; a legal one is interpolated"

# The invariant behind it, so a NEW snippet cannot reintroduce the class: inside a
# `php:eval` region every interpolation must name a pre-escaped `Q_*` variable.
# Regions are delimited by the opening quote ending its line and the closing quote
# starting one — the shape every snippet in both scripts is written in, which is
# why that shape is worth keeping.
php_region_interpolations() {
  awk '
    /php:eval "$/ { inphp = 1; regions++; next }
    inphp && /^"/ { inphp = 0; next }
    inphp {
      s = $0
      while (match(s, /\$\{[A-Za-z_][A-Za-z0-9_]*\}/)) {
        v = substr(s, RSTART + 2, RLENGTH - 3)
        if (v !~ /^Q_/) printf "%s:%d: ${%s} is not pre-escaped\n", FILENAME, FNR, v
        s = substr(s, RSTART + RLENGTH)
      }
    }
    END { if (regions == 0) printf "%s: no php:eval region found — the check would be vacuous\n", FILENAME }
  ' "$1"
}
for script in "${SETUP}" "${TEARDOWN}"; do
  offenders="$(php_region_interpolations "${script}")"
  [ -z "${offenders}" ] || { echo "${offenders}" >&2; fail "raw interpolation into PHP in ${script#"$ROOT"/}"; }
done
pass "no php:eval snippet interpolates a value that was not escaped first"

# === 5. A failed OAuth key probe fails LOUDLY ===============================
#
# The probe answers a question with three states — usable, unusable, and "the
# probe itself did not run" — and collapsing the third into the first is the worst
# of the three: step 9 then dies on exactly the HTTP 500 step 8 exists to prevent,
# while the operator has just been told there was nothing to do.
kp() { with_fn "${SETUP}" 'parse_key_probe' 'printf "%s" "$1" | parse_key_probe' "$1"; }
two_ok="$(printf 'public_key\t/keys/public.key\tok\nprivate_key\t/keys/private.key\tok\n')"
one_bad="$(printf 'public_key\t/keys/public.key\tok\nprivate_key\t/keys/private.key\tbad\n')"
mixed="$(printf 'public_key\t/a/public.key\tok\nprivate_key\t/b/private.key\tok\n')"

[ "$(kp "${two_ok}" 2>/dev/null)" = "$(printf '/keys\tok')" ] \
  || fail "parse_key_probe misreads two usable keys in one directory"
[ "$(kp "${mixed}" 2>/dev/null)" = "$(printf 'MIXED\tok')" ] \
  || fail "parse_key_probe does not flag two different key directories"

# THE DIAGNOSTIC MUST NOT LAND ON STDOUT. This function's stdout IS its return value,
# so a `say` printed there was captured by the caller and became part of KEY_DIR,
# which then reached `mkdir -p` and `generate-keys` as a directory name made of the
# report itself. Both directions are asserted, because only the pair pins it: stdout
# carries exactly the verdict, and the report is still emitted, on stderr.
[ "$(kp "${one_bad}" 2>/dev/null)" = "$(printf '/keys\tbad')" ] \
  || fail "parse_key_probe's diagnostic leaks into its stdout, which is its return value"
grep -q 'private_key: bad' <<<"$(kp "${one_bad}" 2>&1 >/dev/null)" \
  || fail "parse_key_probe reports an unusable key nowhere at all"
if kp '' >/dev/null 2>&1; then
  fail "parse_key_probe reported a verdict for a probe that returned nothing"
fi
if kp "$(printf 'public_key\t/keys/public.key\tok\n')" >/dev/null 2>&1; then
  fail "parse_key_probe reported a verdict from a half-answered probe"
fi

# And the source-level half of the same finding: the command substitution must not
# swallow a drush failure. `|| true` there is what turned "the probe did not run"
# into "the keys are usable" — steps 2 and 5 deliberately carry no such thing.
if awk '/^key_probe=/ { inside = 1 } inside { print } inside && /^"/ { exit }' \
     "${SETUP}" | grep -q '|| true'; then
  fail "the OAuth key probe still collapses a drush failure with '|| true'"
fi
pass "a failed OAuth key probe dies instead of reporting 'nothing to do'"

# === 6. No `ddev delete` runs without a name guard ==========================
#
# `ddev delete -Oy` destroys a project AND its database. Teardown already refuses
# to delete the workspace project unless the overlay names the one setup generated,
# and writes down why: the fixture repo's committed `name:` is IDENTICAL in every
# checkout, so deleting under it reclaims another worktree's project. That reason
# applies verbatim to the per-worktree loop, which gets a worktree carrying the
# tracked config.yaml and no overlay of its own.
NAME_STUB="$(mktemp -d)"
trap 'rm -rf "${STUB_DIR}" "${REC_DIR}" "${NAME_STUB}"' EXIT
ddev_named() {
  cat >"${NAME_STUB}/ddev" <<STUB
#!/usr/bin/env bash
[ "\$1" = 'describe' ] || { echo "STUB-VIOLATION: ddev \$*" >&2; exit 99; }
${2:-}
echo '{"raw":{"name":"$1","approot":"$ROOT","status":"running"}}'
STUB
  chmod +x "${NAME_STUB}/ddev"
}
name_verdict() {
  with_fn "${TEARDOWN}" 'harness_ddev_name' \
    'PATH="'"${NAME_STUB}"':$PATH" harness_ddev_name "$1" >/dev/null && echo own || echo foreign' \
    "$ROOT"
}

for own in 'bakers-pg-1a2b3c4d' 'bakers-pg-1a2b3c4d-feat-x'; do
  ddev_named "${own}"
  [ "$(name_verdict)" = 'own' ] \
    || fail "harness_ddev_name disowned '${own}', which setup's own naming produces"
done
# The three that must never be deleted: the fixture's committed name, a real bakers
# checkout, and a project whose name could not be read at all.
for foreign in 'drupal-11-simple' 'bb-273' ''; do
  ddev_named "${foreign}"
  [ "$(name_verdict)" = 'foreign' ] \
    || fail "harness_ddev_name claimed ownership of the ddev project '${foreign}'"
done
ddev_named 'bakers-pg-1a2b3c4d' 'exit 7'
[ "$(name_verdict)" = 'foreign' ] \
  || fail "harness_ddev_name claimed ownership although 'ddev describe' failed"

# And the shape, so a future loop cannot skip the guard: every `ddev delete` in
# teardown must have a name check within the few lines above it.
# Comment lines are skipped: this script's header and its guards DISCUSS `ddev
# delete` at length, and a checker that cannot tell prose from a command would be
# satisfied by deleting the explanation.
unguarded="$(awk '
  { for (i = 8; i > 1; i--) prev[i] = prev[i - 1]; prev[1] = $0 }
  /^[[:space:]]*#/ { next }
  /ddev delete/ {
    guarded = 0
    for (i = 1; i <= 8; i++) if (prev[i] ~ /harness_ddev_name|name: \$\{WS_DDEV\}/) guarded = 1
    if (!guarded) printf "%s:%d: %s\n", FILENAME, FNR, $0
  }
' "${TEARDOWN}")"
[ -z "${unguarded}" ] || { echo "${unguarded}" >&2; fail "an unguarded 'ddev delete' in teardown"; }
pass "every ddev delete is guarded by a project-name check this script owns"

# === 7. The --help windows cannot drift =====================================
#
# WORKFLOW.md declares `--help` the place an operator finds "the facts that bite",
# which makes a hand-counted line range a defect waiting for the next header edit.
# Both windows were wrong at the same time: one printed three lines of source past
# the end of its header, the other stopped mid-sentence and dropped the clause
# explaining why a failure there is benign.
#
# The pin is computed INDEPENDENTLY of how usage() finds the end — from the comment
# line directly above the header's closing rule — so this asserts the two agree
# rather than restating one of them.
last_header_line() {
  local close_ln
  close_ln="$(grep -n '^# =\+$' "$1" | sed -n '2p' | cut -d: -f1)"
  [ -n "${close_ln}" ] || fail "${1#"$ROOT"/} has no closing header rule"
  sed -n "$((close_ln - 1))p" "$1" | sed 's/^# \{0,1\}//'
}
check_help() {
  local script="$1" help="$2" tail_line
  tail_line="$(last_header_line "${script}")"
  grep -qF "${tail_line}" <<<"${help}" \
    || fail "${script#"$ROOT"/} --help stops before the end of its header (missing: ${tail_line})"
  grep -q 'set -euo pipefail' <<<"${help}" \
    && fail "${script#"$ROOT"/} --help prints script source past the header"
  grep -qE "^[A-Z_]+='" <<<"${help}" \
    && fail "${script#"$ROOT"/} --help prints a variable assignment from the source"
  # Deliberately NOT "the last line ends in a full stop": a header may legitimately
  # end on a command example. The pin above is what catches a truncated window, and
  # it catches the real one — teardown's old `2,28p` stopped one line short, at
  # "It is best-effort —", and the pin names exactly that missing line.
  return 0
}
check_help "${SETUP}" "${setup_help}"
check_help "${TEARDOWN}" "${teardown_help}"
# Every option the script accepts has to be EXPLAINED by the window that claims to
# document it, not merely listed in its synopsis — `--keep-clone` was accepted and
# never described. Two mentions is what distinguishes the two cases.
for opt in '--project' '--keep-clone'; do
  [ "$(grep -c -- "${opt}" <<<"${teardown_help}")" -ge 2 ] \
    || fail "teardown --help lists ${opt} in its synopsis but never explains it"
done
#
# `--workspace-only` joined the list with BB-390. It is the mode `ddev init-worktree`
# runs, and the one option whose whole point is what it does NOT do — so a synopsis
# entry without the explanation is exactly the case this assertion exists for.
for opt in '--project' '--workspace-only'; do
  [ "$(grep -c -- "${opt}" <<<"${setup_help}")" -ge 2 ] \
    || fail "setup --help lists ${opt} in its synopsis but never explains it"
done
pass "both --help windows print their whole header and nothing but it"

# === 8. WORKFLOW.md ========================================================

WF="$ROOT/WORKFLOW.md"

# It must name the scripts rather than a skill …
grep -q 'scripts/setup-test-project.sh' "${WF}" \
  || fail "WORKFLOW.md does not name scripts/setup-test-project.sh"
grep -q 'scripts/teardown-test-project.sh' "${WF}" \
  || fail "WORKFLOW.md does not name scripts/teardown-test-project.sh"
# Lifecycle loading, required-skill delivery and collection switching are covered
# by the maintained core contract. Per-owner build.prompt overrides were retired.
(cd "$ROOT/bakers-cli" && pnpm exec vitest run --root . core/tests/workflow/step-contract.test.ts) \
  || fail "the current workflow contract failed"
pass "the workflow loads and validates through the maintained contract"

# === 9. What only a live run found, guarded ==================================
#
# Two defects survived every unit test that existed and were found by running the
# script for real. Neither had a regression guard, so a refactor could reintroduce
# them silently — which is the whole argument for putting them here.

# PHP SINGLE-QUOTED STRINGS INTERPRET NO ESCAPES, so '\t' is the two characters `\`
# and `t`. That made a tab comparison that could never match: setup rewrote an
# already-correct repo entry on every run, and read a healthy control plane as
# having two unusable OAuth keys.
badtab="$(awk '
  /php:eval "$/ { inphp = 1; next }
  inphp && /^"/ { inphp = 0; next }
  inphp && /\x27\\\\t\x27/ { printf "%s:%d: %s\n", FILENAME, FNR, $0 }
' "${SETUP}" "${TEARDOWN}")"
[ -z "${badtab}" ] || { echo "${badtab}" >&2; fail "a PHP snippet uses '\\t', which PHP does not interpret"; }
grep -q 'chr(9)' "${SETUP}" || fail "setup no longer builds its tab with chr(9)"

# THE GLOBAL-COMMANDS RACE. Another project's `ddev start` transiently repopulates
# the shared cache volume; a container starting inside that window dies. Losing this
# retry while porting the script is what made three consecutive setups fail, so both
# halves are asserted: the marker, and that it is retried rather than merely named.
grep -q 'ddev-global-cache/global-commands' "${SETUP}" \
  || fail "setup no longer recognises the shared global-commands race"
grep -q 'for attempt in 1 2 3' "${SETUP}" \
  || fail "setup recognises the global-commands race but no longer retries it"

# `workspaces/` staying git-ignored is what the whole clone-hygiene story rests on,
# and AC12 called it "asserted" while nothing asserted it.
grep -qxF '/workspaces/' "$ROOT/.gitignore" \
  || fail ".gitignore no longer ignores /workspaces/, so the generated clone becomes committable"

# The completion summary has to name the ONE sub-work the generated loader covers.
# An operator who creates a bug or a work:code ticket burns a real dispatch on a
# configuration error, and the summary is the last thing read before they do it.
summary="$(awk '/^cat <<SUMMARY$/ { inside = 1; next } inside && /^SUMMARY$/ { exit } inside { print }' "${SETUP}")"
[ -n "${summary}" ] || fail "setup's completion summary could not be located"
grep -q 'work:docs' <<<"${summary}" \
  || fail "setup's completion summary does not say the generated loader covers work:docs only"
# The committed bakers-playground conductor config owns the claim hook. The setup script
# generates only the machine-local connection config now, so this contract must not assert
# implementation details from a different repository against its source text.
pass "the two live-run defects, the gitignore rule and the loader's coverage are all guarded"

# === 10. A STALE build is refused, not just a missing one ====================
#
# The wiring links THIS checkout's build into the workspace so the run exercises
# THIS branch. `assert_built` only ever asked whether the files exist — and a build
# that exists but predates the source is the worse failure of the two, because the
# workspace then runs a different CLI than the branch under test and a green result
# is about the wrong code. Found by running setup for real: the local conductor build
# was a day old and still carried the pre-BB-232 herdr-killing `stop`, so a live
# observation contradicted the source that lands.
STALE_DIR="$(mktemp -d)"
trap 'rm -rf "${STUB_DIR}" "${REC_DIR}" "${NAME_STUB}" "${STALE_DIR}"' EXIT
mkdir -p "${STALE_DIR}/src" "${STALE_DIR}/dist"
: >"${STALE_DIR}/src/a.ts"
: >"${STALE_DIR}/dist/a.js"
current_verdict() {
  # The nested subshell matters: `die` calls `exit`, which would end the shell doing
  # the reporting before it could report.
  with_fn "${SETUP}" 'assert_current' \
    '( assert_current "$1/src" "$1/dist/a.js" probe ) >/dev/null 2>&1 && echo current || echo stale' \
    "${STALE_DIR}"
}
touch -d '2020-01-01' "${STALE_DIR}/src/a.ts"
touch -d '2021-01-01' "${STALE_DIR}/dist/a.js"
[ "$(current_verdict)" = 'current' ] \
  || fail "assert_current called a build stale although it is newer than its source"
touch -d '2022-01-01' "${STALE_DIR}/src/a.ts"
[ "$(current_verdict)" = 'stale' ] \
  || fail "assert_current accepted a build older than its own source"
pass "a build that exists but predates its source is refused"

# === 11. The plugin marketplace still validates =============================
#
# The retirement removed a skill directory, and the marketplace manifest is what
# would be left pointing at it.
[ -x "$ROOT/.claude-plugin/verify-marketplace.sh" ] \
  || fail ".claude-plugin/verify-marketplace.sh is missing or not executable"
(cd "$ROOT" && ./.claude-plugin/verify-marketplace.sh >/dev/null) \
  || fail ".claude-plugin/verify-marketplace.sh failed"
pass "the plugin marketplace manifest validates"

# Assignment uses the normal worker connection and no separate credential.
! grep -q 'OPERATOR_CLIENT_ID\|bakers.operator.config.js\|bakers-operator' "${SETUP}" \
  || fail "setup introduces a separate assignment identity"
pass "assignment uses the existing worker connection"

echo "OK: test-project scripts contract"
