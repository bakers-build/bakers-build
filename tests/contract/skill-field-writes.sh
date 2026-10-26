#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# BB-403 — the skills write through dropsh FIELD PARAMETERS, asserted.
#
#   bash tests/contract/skill-field-writes.sh
#
# dropsh 0.6.1 lets create/update name their fields directly and list them with
# --fields. Before this ticket every write-owning skill instead dumped the whole
# schema, built a JSON:API document with jq into a temp file, and sent it twice
# with --data @file. This gate is what stops that path from growing back the
# next time a skill is edited.
#
# `tests/contract/` does NOT run in CI, so run it by hand for any change under
# `.claude/skills/bakers-build/`.
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

# The skills that perform a create or an update — shared with
# skill-substance.sh so the two gates cannot disagree about who writes.
# `require_writers` fails outright when the derivation stops matching, which is
# what stops section 1 from passing vacuously.
#
# ONLY SECTION 1 IS DERIVED. Sections 2-4 name `create-ticket`,
# `publish-comment`, `create-project` and `record-measurement` literally, so a
# writer added later inherits the envelope checks but NOT the rich-text, format
# or label ones. Add it to those lists by hand, or it is half-covered.
. "$(dirname "${BASH_SOURCE[0]}")/lib/writers.sh"
require_writers

# --- 1. No write is assembled as a JSON:API envelope ------------------------
for f in "${WRITERS[@]}"; do
  name="$(basename "$(dirname "$f")")"
  check "$name: no --data envelope on the write path" \
    bash -c "! grep -qE -- '--data \"?@' '$f'"
  # Whitespace-tolerant on purpose: the earlier literal `\"data\":{\"type\"`
  # would not have seen `jq -n '{data: {type: …'`, which is the same defect
  # written the way a person actually writes it.
  check "$name: no jq-built JSON:API document" \
    bash -c "! grep -q 'jq -n' '$f' || ! grep -qE '\"?data\"?[[:space:]]*:[[:space:]]*[{][[:space:]]*\"?type' '$f'"
  check "$name: no ENVELOPE_FILE" \
    bash -c "! grep -q 'ENVELOPE_FILE' '$f'"
done

# --- 2. Discovery is --fields, not a schema dump ----------------------------
check 'no skill teaches `schema --for create` as the discovery step' \
  bash -c "! grep -rn -- 'schema .*--for create' '$SKILLS'"

for name in bb-create-ticket bb-publish-comment bb-create-project; do
  check "$name: names --fields as its discovery step" \
    grep -q -- '--fields' "$SKILLS/$name/SKILL.md"
done

# --- 3. The invariants the field path must NOT lose ------------------------
#
# That every write is ONE live call is asserted by skill-substance.sh;
# what that file cannot see is that the rich-text body still comes from a file,
# that it is passed in the `=` form, and that the storage format is still named.
#
# -F, not -q: `.` is a regex wildcard, so the old `--$field.value` pattern also
# matched `--descriptionXvalue` — and, more to the point, said something other
# than what it meant.
for pair in 'bb-create-ticket:description' 'bb-publish-comment:body'; do
  name="${pair%%:*}"; field="${pair##*:}"
  f="$SKILLS/$name/SKILL.md"
  check "$name: the rich text is passed as --$field.value= from a file" \
    bash -c "grep -qF -- '--$field.value=' '$f' && grep -qE 'mktemp|_FILE' '$f'"
  check "$name: the bb_rich format is named on the write" \
    bash -c "grep -qF -- '--$field.format bb_rich' '$f'"
done

# --- 4. --label_names replaces UUID resolution -----------------------------
check 'record-measurement resolves its label by NAME, not by a searched uuid' \
  bash -c "grep -q -- '--label_names' '$SKILLS/bb-record-measurement/SKILL.md' \
    && ! grep -q 'TERM_UUID' '$SKILLS/bb-record-measurement/SKILL.md'"
check 'no skill teaches a bb_term search to resolve a label' \
  bash -c "! grep -rn 'search bb_term' '$SKILLS'"

# --- 5. The canonical phrase moved with the write path ---------------------
#
# `body file → field parameters → live`. The dry-run left the phrase because it
# buys nothing on this path: dropsh 0.6.1 runs schema validation BEFORE the
# `dryRun` branch (`create.js`/`update.js`), so the live write validates
# identically — and `alterRequest` lives inside the JSON:API client, so a
# `--label_names` dry-run prints a payload that is not the one sent. It survives
# only as a named escape hatch, documented once, in `bb-workflow`.
check 'no skill still quotes "file → envelope → dry-run"' \
  bash -c "! grep -rn 'envelope → dry-run' '$SKILLS'"
check 'no skill still quotes the dry-run step in the canonical phrase' \
  bash -c "! grep -rn 'field parameters → dry-run' '$SKILLS'"
check 'the canonical phrase is "body file → field parameters → live"' \
  bash -c "grep -rq 'field parameters → live' '$SKILLS'"

# The live path validates once; no mandatory dry-run is part of this contract.
check 'normal validation and uncertain-write reconciliation remain mandatory' \
  bash -c "grep -q 'outgoing schema validation enabled' '$SKILLS/bb-workflow/references/ticket-writes.md' \
    && grep -q 'never blindly repeat the create' '$SKILLS/bb-workflow/references/ticket-writes.md'"

# --- 6. No recipe instructs an auth profile --------------------------------
#
# BB-391 left exactly ONE auth provider (`id: 'bakers'`), so there is no profile
# to name: an agent that obeys prose telling it to use "session auth" adds
# `--auth-profile session` and gets an AuthError on every write, permanently.
# skill-substance.sh already inverts the FLAG for the writers; what it
# cannot see is the SENTENCE that makes an agent invent the flag. Both halves are
# needed — the flag check catches the symptom, this one catches the instruction.
# Scanned tree-wide, not just over writers(), because a skill that delegates its
# write (create-spec → publish-comment) can instruct the profile just as well.
check 'no skill instructs an auth profile or a named identity on a write' \
  bash -c "! grep -rniE -- '--auth-profile|session auth|explicit (pm|session|project.manager) auth|\`(session|pm|project_manager)\` (patch|post|write)' '$SKILLS'"

# ---------------------------------------------------------------------------
if [ "$failures" -gt 0 ]; then
  printf '\n%d check(s) FAILED\n' "$failures"
  exit 1
fi
printf '\nOK: BB-403 field-parameter writes\n'
