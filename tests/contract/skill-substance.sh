#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# BB-290 — every skill still carries the substance its contract promises.
#
#   bash tests/contract/skill-substance.sh
#
# WHY. A mutation test (blank a skill, see what notices) found that 12 of 34 skills were checked by NOTHING. Their entire
# contents could be deleted and the suite stayed green — including the canonical
# contract `bb-workflow`, the state write `transition-ticket`, the ticket read
# `read-ticket`, and the merge gate `merge-mr`. 489 passing checks, silent on the
# four skills that carry the most consequence.
#
# That is the blind spot a grep suite grows: it is dense where prose is easy to
# quote and absent where behaviour lives. The checks below are POSITIVE and
# structural — each fails when the substance goes missing, which is exactly what
# the negative "routes nothing" checks cannot do (an empty file routes nothing
# beautifully).
#
# CI runs it through bakers-cli/core/tests/workflow/repository-contracts.test.ts.
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

frontmatter() { awk '/^---$/{n++; next} n==1{print} n>=2{exit}' "$1"; }

# Read the BODY, never the frontmatter. A check that greps the whole file can be
# satisfied by the `description:` line — which is how two of these checks first
# shipped useless: `create-project`'s description already contains "validated"
# and `bb-runtime-ddev`'s contains "base URL", so both stayed green against an
# emptied body. The mutation test caught it; it is the failure mode to watch for
# in every substance check.
body() { awk '/^---$/{n++; next} n>=2' "$1"; }

# The checks below run their greps in `bash -c` subshells; export so both helpers
# resolve there instead of failing open (a missing function would make the check
# error, not silently pass — but exporting keeps the intent readable).
export -f frontmatter body

# --- A. Every write is one live, validated call -----------------------------
#
# BB-403 INVERTED the dry-run half of this pair, on the same reasoning that
# BB-391 inverted the auth-profile half below: what is gone is not the
# validation but the SECOND call. dropsh 0.6.1 runs schema validation before the
# `dryRun` branch (`create.js`/`update.js`), so the live write validates
# identically and a preceding dry-run buys no check — while `alterRequest` runs
# inside the JSON:API client, past that branch, so a `--label_names` dry-run
# prints a payload that is not the one sent. The check is inverted rather than
# deleted so the rule keeps a guard: a recipe that grows the second call back
# fails here. Where the dry-run legitimately survives — one named escape hatch
# on `create`, documented once in `bb-workflow` — is asserted by
# tests/contract/skill-field-writes.sh, which owns that rule.
#
# BB-391 INVERTED the auth-profile half of this pair. It used to require an
# explicit `--auth-profile` on every write, because two scoped OAuth2 profiles
# (`session` / `bb:session` and `pm` / `bakers:project_manager`) meant a write
# had to pick one. What BB-391 removed is that CHOICE, not the scope: there is
# now ONE identity (`bakers`) on ONE umbrella scope (`bb:session`), so naming a
# profile is a stale flag that would fail to resolve. The scope still decides
# which OPERATIONS a machine identity has at all — for a client_credentials token
# simple_oauth overwrites the account's permissions with exactly the scope's —
# while BB-359's OG ranks decide which ROWS those operations reach. The check
# is inverted rather than deleted so the rule keeps a guard: a write that names
# a profile again fails here instead of failing at runtime.
. "$(dirname "${BASH_SOURCE[0]}")/lib/writers.sh"
require_writers

for f in "${WRITERS[@]}"; do
  name="$(basename "$(dirname "$f")")"
  check "$name: the write names no auth profile" bash -c "! grep -q -- '--auth-profile' '$f'"
  check "$name: the write is one live call, not a dry-run plus a live one" \
    bash -c "! grep -q -- '--dry-run' '$f'"
done

# --- B. Every step owner routes once and stops ------------------------------
#
# The inverse of the helper rule: an owner that stopped transitioning would strand
# its ticket, and nothing else in the suite reads `summarize-verification` or
# `verify-on-environment` at all. The owners are the ones the frame's routing table names.
owners() {
  awk '/^\| State \| Owner \|/{t=1; next} t && !/^\|/{exit} t' "$SKILLS/bb-workflow/SKILL.md" |
    grep -oE '@bakers-build/bb-[a-z-]+' | sed 's|@bakers-build/||' | sort -u
}

check 'the frame routes at least one owner' test -n "$(owners)"
for name in $(owners); do
  instructions="$(body "$SKILLS/$name/SKILL.md")"
  check "$name: owns a transition" grep -q '@bakers-build/bb-transition-ticket' <<< "$instructions"
  check "$name: stops after its step" grep -qiE '\bstop\b' <<< "$instructions"
done

# --- C. The named capabilities still carry their one contract ---------------
#
# One assertion each, aimed at the substance rather than at a sentence: the thing
# the skill exists to do must still be in the file.

# read-ticket owns the canonical pm markdown read.
rt="$SKILLS/bb-read-ticket/SKILL.md"
check 'read-ticket carries the pm read with the markdown renderer' \
  bash -c "grep -qE '^[[:space:]]*bakers dropsh .*--format md .*read bb_ticket' '$rt'"
check 'read-ticket keeps comments in the read' grep -q -- '--include comments' "$rt"

# merge-mr owns the merge gate that stands between review and done.
mm="$SKILLS/bb-merge-mr/SKILL.md"
check 'merge-mr carries the merge call' bash -c "grep -qE '^[[:space:]]*glab mr merge' '$mm'"
for gate in 'pipeline' 'conflict' 'squash'; do
  check "merge-mr keeps its $gate gate" grep -qi "$gate" "$mm"
done

# bb-workflow's authoring contract: recipes, runtime guides, hints and the three input kinds.
ws="$SKILLS/bb-workflow/references/authoring.md"
check 'bb-workflow reaches its authoring contract' grep -q 'references/authoring.md' "$SKILLS/bb-workflow/SKILL.md"
for key in '## Recipes' '## Runtime guides' '## Project hints'; do
  check "bb-workflow documents $key" grep -qx "$key" "$ws"
done
for kind in command prompt data; do
  check "bb-workflow documents the \`.$kind\` kind" grep -qE "\`\.$kind\`" "$ws"
done

# The remaining previously-unchecked skills: one substance assertion each.
check 'bb-runtime-ddev checks for a live stack before starting one' \
  bash -c "body '$SKILLS/bb-runtime-ddev/SKILL.md' | grep -q 'ddev describe'"
check 'bb-runtime-ddev verifies the base URL responds' \
  bash -c "body '$SKILLS/bb-runtime-ddev/SKILL.md' | grep -qi 'base URL actually responds\|verify the base URL'"
# BB-391 forbids the auth profile (one identity on one scope — see section A);
# BB-403 replaced the schema dump with --fields as the discovery step.
check 'create-project lists the settable fields and names no auth profile' \
  bash -c "body '$SKILLS/bb-create-project/SKILL.md' | grep -q -- '--fields' \
    && ! body '$SKILLS/bb-create-project/SKILL.md' | grep -q -- '--auth-profile'"
check 'publish-origin-feedback posts a note to the origin issue' \
  bash -c "body '$SKILLS/bb-publish-origin-feedback/SKILL.md' | grep -q 'glab issue note'"
check 'record-measurement replaces only its own namespace' \
  bash -c "body '$SKILLS/bb-record-measurement/SKILL.md' | grep -qi 'namespace'"
check 'publish-comment names the bb_rich storage format' \
  bash -c "body '$SKILLS/bb-publish-comment/SKILL.md' | grep -q 'bb_rich'"

# Terminal retrospective: keep the gate and its write scope ordering observable.
tt="$SKILLS/bb-transition-ticket/references/terminal-retrospective.md"
check 'transition-ticket reaches its conditional retrospective' grep -q 'references/terminal-retrospective.md' "$SKILLS/bb-transition-ticket/SKILL.md"
check 'transition-ticket gates retrospective on terminal destinations' \
  bash -c "cat '$tt' | grep -qE 'destination.*done.*cancelled'"
check 'transition-ticket writes retrospective before retiring the run' \
  bash -c "cat '$tt' | grep -q 'Ask → metric → comment → state write'"
check 'transition-ticket preserves the unanswered path' \
  bash -c "cat '$tt' | grep -q 'no rating, no comment'"

# ---------------------------------------------------------------------------
if [ "$failures" -gt 0 ]; then
  printf '\n%d check(s) FAILED\n' "$failures"
  exit 1
fi
printf '\nOK: BB-290 skill substance\n'
