#!/usr/bin/env bash
set -euo pipefail

# The run frame's structure: WORKFLOW.md is an entry line plus phase-named hints, the frame
# defines the six phases and the stop rule, and the default recipe carries its state sections.
# No CLI reads these files any more, so this contract is what stops the structure drifting.
#
#   bash tests/contract/workflow-frame.sh
#
# CI runs it through bakers-cli/core/tests/workflow/repository-contracts.test.ts.
# Runs on bash 3.2 (macOS `/bin/bash`).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WF="$ROOT/WORKFLOW.md"
SKILLS="$ROOT/.claude/skills/bakers-build/skills"
FRAME="$SKILLS/bb-workflow/SKILL.md"
RECIPE="$SKILLS/bb-recipe-matt/SKILL.md"
PHASES='read provision work validate deliver transition'
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then printf 'PASS %s\n' "$label"; else printf 'FAIL %s\n' "$label"; failures=$((failures + 1)); fi
}

# Hard-wrapped prose: assert statements against a flattened copy.
flatten() { { tr '\n' ' ' < "$1" | tr -s ' '; } 2>/dev/null || true; }
has() { printf '%s' "$1" | grep -qF -- "$2"; }
description() { awk '/^---$/{n++; next} n==1 && /^description:/{print; exit}' "$1"; }

# --- WORKFLOW.md: entry line plus phase-named sections only ---------------------------------

check 'WORKFLOW.md carries the entry line' \
  grep -qxF 'Invoke `bakers:bb-workflow` and follow it for the ticket'"'"'s current state.' "$WF"
only_phase_sections() {
  local heading name
  while IFS= read -r heading; do
    name="${heading#\#\# }"
    case " $PHASES " in *" $name "*) ;; *) echo "    unexpected section: $heading" >&2; return 1 ;; esac
  done < <(grep '^## ' "$WF")
}
check 'WORKFLOW.md has only phase-named sections' only_phase_sections
for retired in 'Loaded skills' 'Skill set' 'Skills' 'Checks' 'Required skills' 'Standards'; do
  check "WORKFLOW.md has no $retired section" bash -c "! grep -qE '^#+ $retired\$' '$WF'"
done

# --- The frame: six phases, routing, binding and stop rules ---------------------------------

FRAME_FLAT="$(flatten "$FRAME")"
for phase in $PHASES; do
  check "the frame defines the $phase phase" grep -qx "## $phase" "$FRAME"
done
check 'the frame states the per-phase reading rule' \
  has "$FRAME_FLAT" 'read the same-named sections of the recipe, loaded guides and `WORKFLOW.md`; they refine bindingly'
for owner in bb-qualify-ticket bb-prepare-deployment bb-post-deployment bb-verify-on-environment bb-summarize-verification; do
  check "the frame routes to $owner" has "$FRAME_FLAT" "@bakers-build/$owner"
done
check 'the frame resolves the recipe from the ticket field' has "$FRAME_FLAT" '`bb-recipe-<name>` from the ticket'"'"'s `recipe` field'
check 'the frame provisions lazily' has "$FRAME_FLAT" 'No hint and no need → skip silently'
check 'the frame binds required skills' has "$FRAME_FLAT" 'read its **complete** `SKILL.md`, then announce what you loaded'
check 'the frame allows replacement only on explicit request' has "$FRAME_FLAT" 'replaced only when the user explicitly asks'
check 'the frame stops on a missing recipe, section, type or skill' \
  has "$FRAME_FLAT" 'stop and report the exact identifier that failed'
check 'the stop comes before any mutation' \
  has "$FRAME_FLAT" 'Stop *before* editing a file, committing, publishing a comment, asking for confirmation, or transitioning the ticket'

# --- bb-recipe-matt: state sections and a description qualification can choose from -----------

for state in plan working review; do
  check "bb-recipe-matt has a $state section" grep -qx "## $state" "$RECIPE"
done
check 'bb-recipe-matt has a bug subsection' grep -qx '### bug' "$RECIPE"
RECIPE_DESCRIPTION="$(description "$RECIPE")"
for word in feature bug chore 'Project default'; do
  check "bb-recipe-matt's description names $word" has "$RECIPE_DESCRIPTION" "$word"
done
# A recipe may live in any plugin, so it calls no bakers.build helper; the frame publishes and routes.
helpers="$(grep -oE '@bakers-build/[a-z-]+' "$RECIPE" | grep -vx '@bakers-build/bb-workflow' || true)"
check 'bb-recipe-matt calls no bakers.build helper' test -z "$helpers"
# Recipes carry the bb- prefix, so a lookup for bare `recipe-*` skills finds none.
check 'recipe lookups name bb-recipe-*' bash -c "! grep -rqF -- '\`recipe-*\`' '$SKILLS' '$ROOT/docs'"

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) FAILED"
  exit 1
fi
echo 'OK: workflow frame'
