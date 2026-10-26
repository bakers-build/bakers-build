#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# BB-290 — "helper skills route nothing", asserted as a property.
#
#   bash tests/contract/skill-helper-boundary.sh
#
# `@bakers-build/bb-workflow` states the rule: a capability skill declares no `when`,
# produces one outcome, and routes nothing — with `@bakers-build/bb-ensure-qualification`
# as the one documented exception (its recovery route back to `qualification`).
#
# WHY THIS FILE EXISTS, and what it replaces. The suite used to assert this rule
# by grepping each helper for a SENTENCE about it: 'invokes no sub-skill',
# 'no dispatcher', 'selects no destination', 'never writes a qualification
# handoff'. That is a change detector, not a test. It is simultaneously
#
#   * too strict — every rewrite breaks it, including better ones. Four such
#     false alarms were hit while editing these skills: one on capitalisation
#     ('Technical details' vs 'technical-details'), one on a LINE BREAK falling
#     between 'Suppress the execution diary' and 'by default', one on a
#     grammar fix, and one where the required string 'no destination' had
#     forced the prose into the double negative "or write no destination" —
#     the test did not protect the contract, it broke it; and
#   * too weak — a skill can carry the sentence "invokes no dispatcher" and
#     invoke one three lines later. Nothing checked.
#
# So assert the property. Two invariants, over the capability set DERIVED from
# the tree rather than hardcoded, so a new helper is covered the day it lands.
#
# Naming versus invoking: a helper may name another capability as an example of
# a command owner, but it may not invoke one. The needles below match invoking
# verbs only.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILLS="$ROOT/.claude/skills/bakers-build/skills"
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then printf 'PASS %s\n' "$label"; else printf 'FAIL %s\n' "$label"; failures=$((failures + 1)); fi
}

# A capability skill is neither a step owner nor the frame. Step owners are the core skills the
# frame's routing table names and every `bb-recipe-*` skill.
STEP_OWNERS='bb-(qualify-ticket|prepare-deployment|post-deployment|verify-on-environment|summarize-verification|recipe-[a-z-]+)'

# A third exclusion, and it is not a hack: `bb-workflow` is a CONTRACT DOCUMENT.
# It has no `when` and no bundle section, so it lands in the capability set by the
# structural test — but it does not execute anything; it describes what a step
# owner does, and doing so it must write the sentence "choose the transition
# destination and invoke `@bakers-build/bb-transition-ticket`". That is syntactically
# identical to an instruction, so no regex separates them. Naming the document is
# honest where a cleverer needle would only hide the ambiguity.
CONTRACT_DOCS='bb-workflow'

capabilities() {
  local d n
  for d in "$SKILLS"/*/; do
    n="$(basename "$d")"
    grep -qxE "$STEP_OWNERS" <<<"$n" && continue
    grep -qx "$n" <<<"$CONTRACT_DOCS" && continue
    printf '%s\n' "$n"
  done
}

# An INVOCATION of skill $2 inside file $1 — an invoking verb within a short
# distance of the reference, so a prose mention does not match.
invokes() {
  grep -qiE "(invoke|invokes|invoking|run|runs|call|calls)[^.]{0,40}@bakers-build/$2" "$1"
}

# --- I1: a capability does not route ---------------------------------------
#
# Routing means invoking the transition. Qualification recovery and initial ticket intake
# have explicit routing contracts; ordinary work helpers do not choose a next state.
routers=()
while IFS= read -r name; do
  case "$name" in bb-ensure-qualification|bb-create-ticket) continue ;; esac
  invokes "$SKILLS/$name/SKILL.md" 'bb-transition-ticket' && routers+=("$name")
done < <(capabilities)
check 'no capability invokes the transition outside qualification recovery and ticket intake' \
  bash -c "test ${#routers[@]} -eq 0 || { echo \"    routers: ${routers[*]:-}\" >&2; false; }"

check 'the documented exception still routes its recovery' \
  bash -c "grep -qiE 'invoke .@bakers-build/bb-transition-ticket. with destination .qualification.' '$SKILLS/bb-ensure-qualification/SKILL.md'"

# --- I2: a capability starts no phase work ---------------------------------
#
# The step owners drive qualification and the recipe states; a helper that invoked one would be
# doing a neighbouring step's work — the failure `@bakers-build/bb-workflow` calls out.
PHASE_SKILLS='bb-(qualify-ticket|recipe-[a-z-]+)'
starters=()
while IFS= read -r name; do
  grep -qiE "(invoke|invokes|invoking)[^.]{0,40}@bakers-build/$PHASE_SKILLS" "$SKILLS/$name/SKILL.md" \
    && starters+=("$name")
done < <(capabilities)
check 'no capability invokes a phase owner' \
  bash -c "test ${#starters[@]} -eq 0 || { echo \"    starters: ${starters[*]:-}\" >&2; false; }"

# --- I3: only the renderer formats links ------------------------------------
#
# `@bakers-build/bb-run-outtake` owns presentation, so it owns the written form of a link. A
# step hands over artifact PATHS; the outtake decides they come out as absolute
# durable `https://` URLs. The rule had drifted into four places — three copies
# in two step owners plus the bundle — which is how a formatting rule ends up
# restated slightly differently in each and enforced in none.
# The needle is the backticked `Links` SECTION near a formatting word — not any
# sentence about links. `bb-workflow/references/evidence.md` still states the global rule
# ("External links are absolute https:// URLs") for output that never passes
# through an outtake, such as an audit report; a broader needle swallows that too
# and would push a legitimate cross-cutting rule out of the one place it belongs.
formatters=()
while IFS= read -r f; do
  [ "$(basename "$(dirname "$f")")" = 'bb-run-outtake' ] && continue
  grep -qE '`Links`[^.]{0,80}absolute' "$f" \
    && formatters+=("$(basename "$(dirname "$f")")")
done < <(find "$SKILLS" -name SKILL.md)
check 'only bb-run-outtake states the link rendering rule' \
  bash -c "test ${#formatters[@]} -eq 0 || { echo \"    also formatting: ${formatters[*]:-}\" >&2; false; }"

check 'bb-run-outtake actually states it' \
  bash -c "grep -qiE 'durable.*https://|absolute .https://. URL' '$SKILLS/bb-run-outtake/SKILL.md' \
    && ! grep -qiE 'absolute .file://. URL' '$SKILLS/bb-run-outtake/SKILL.md'"

# --- Coverage note ----------------------------------------------------------
#
# Report the derived set, so a reader can see the check is not silently covering
# two skills. A shrinking count is a signal in itself.
printf '\n%s capability skills checked: %s\n' "$(capabilities | wc -l | tr -d ' ')" "$(capabilities | paste -sd' ')"

if [ "$failures" -gt 0 ]; then
  printf '\n%d check(s) FAILED\n' "$failures"
  exit 1
fi
printf 'OK: BB-290 helper boundary\n'
