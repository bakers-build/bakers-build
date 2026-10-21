# ---------------------------------------------------------------------------
# writers.sh — WHICH SKILLS PERFORM A WRITE. Sourced, never run.
#
#   SKILLS="…/.claude/skills/bakers-build/skills"
#   . "$(dirname "${BASH_SOURCE[0]}")/lib/writers.sh"
#   require_writers            # populates WRITERS, or exits 1
#   for f in "${WRITERS[@]}"; do …; done
#
# It lives here because TWO gates need the same answer —
# skill-substance.sh and skill-field-writes.sh — and a definition
# copied into both is a definition that drifts in one.
#
# It is under `lib/` and not beside the gates on purpose: a helper at the
# `tests/contract/*.sh` level would read as a gate.
# ---------------------------------------------------------------------------

# Derived from the recipes themselves, so a new writer is covered the day it
# appears rather than the day someone remembers to list it. Requires $SKILLS.
writers() {
  grep -rlE --include='*.md' '^[[:space:]]*bakers dropsh .*(create|update) ' "$SKILLS"
}

# The floor below which the DERIVATION is broken rather than the tree small.
# Today: create-ticket, publish-comment, transition-ticket, record-measurement.
# Raise it when a writer is added; never lower it to make a run go green.
WRITERS_MIN=${WRITERS_MIN:-4}

# Populate the WRITERS array, or fail the whole gate.
#
# `for f in $(writers)` cannot do this. `set -e` does NOT abort on a failing
# command substitution in a `for` list — verified:
#
#   bash -c 'set -e; for f in $(grep -l NOPE /dev/null); do :; done; echo SURVIVED'
#
# prints SURVIVED. So a writers() regex that stops matching turns every
# per-writer check into zero checks and the gate still exits 0, announcing OK.
# A gate that cannot find its subjects has failed, not passed. (`mapfile` also
# removes the unquoted-glob exposure of the `$(…)` form.)
require_writers() {
  mapfile -t WRITERS < <(writers)
  if [ "${#WRITERS[@]}" -lt "$WRITERS_MIN" ]; then
    printf 'FAIL writers(): derived %d write-owning skill(s), expected at least %d.\n' \
      "${#WRITERS[@]}" "$WRITERS_MIN" >&2
    printf '     The derivation is broken, so every per-writer check below would\n' >&2
    printf '     have been skipped silently. Fix writers() in %s.\n' \
      "${BASH_SOURCE[0]}" >&2
    exit 1
  fi
}
