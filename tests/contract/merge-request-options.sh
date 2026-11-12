#!/usr/bin/env bash
set -euo pipefail

# BB-274 — how a merge request is opened and merged: target, squash commits, delete source
# branch — stated tool-neutrally, with the deletion guarded to branches it is safe to delete.
#
# Why a file contract is the honest gate here. Nothing in this repository executes these options.
# The MR is created and merged by an agent on its own machine with its own client — `glab` on one,
# the GitLab API on the next — so there is no code path to unit-test and a mocked substitute would
# assert nothing about the real one. What CAN drift is the prose, and it drifts silently in three
# distinct ways, each with no error anywhere:
#
#   * a rule phrased as a `glab` flag simply does not exist for an agent without `glab`, and a merge
#     call that names neither `squash` nor `should_remove_source_branch` does not get `false` — it
#     gets whatever the MR already stores, set at creation time or by a forge project setting;
#   * without the squash a ticket's branch lands as its own string of commits rather than as the one
#     commit the convention asks for — and with it, the per-commit `ref:<identifier>` trailers are
#     discarded, so the squash body `references/merge.md` writes is what carries the reference across;
#   * an unguarded "delete the source branch" is destructive rather than merely wrong: this project
#     protects NO branch, so `main` is deletable and `develop` is spared only by being the default.
#
# The last one is why the delete-source-branch guard is asserted per file rather than once. Its
# plausible regression is not a rewrite but a tidy-up: the guard reads like prose padding to someone
# shortening the file, and removing it is invisible, because the option keeps working right up to
# the first merge whose source had to survive.
#
# This script is run by `bakers-cli/core/tests/workflow/mr-options.test.ts`, so it fails
# `pnpm --filter @bakers-build/core test` — hence CI — rather than being a gate in name only.
#
# Runs on bash 3.2 (macOS `/bin/bash`): no `mapfile`, no `declare -A`. No `python3`.

# CONTRACT_ROOT exists for FALSIFICATION (AC 4). A contract that cannot fail asserts nothing, so the
# root is overridable and the falsification runs against a throwaway MIRROR of all three sources
# asserted below — the frame's state file and references and the convention doc — never against the working tree, which
# no test may mutate.
ROOT="${CONTRACT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# BB-424 retired `implement-ticket` — the step owner calls the selected implementation method
# directly — so the MR instruction it used to carry now lives in `bb-workflow`, the context
# every `working` run applies. Same three properties, same region shape, different home.
IMPL_ROOT="$ROOT/.claude/skills/bakers-build/skills/bb-workflow/references/working.md"
IMPL="$ROOT/.claude/skills/bakers-build/skills/bb-workflow/references/delivery.md"
MERGE="$ROOT/.claude/skills/bakers-build/skills/bb-workflow/references/merge.md"
# `WORKFLOW.md` › `## Standards` declares itself the SOURCE of the merge-request convention, so it
# is part of this contract even though the two skills are what an agent executes. A convention whose
# stated source is silent about one of its own options is the drift this ticket exists to remove —
# and the silence would be invisible, because both halves would read as complete on their own.
# The convention text moved out of WORKFLOW.md (whose Standards section is pointers only) into
# docs/bakers/git-and-delivery.md; that note is now the stated source this contract binds.
WF="$ROOT/docs/bakers/git-and-delivery.md"
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then printf 'PASS %s\n' "$label"; else printf 'FAIL %s\n' "$label"; failures=$((failures + 1)); fi
}

# --- Helpers ------------------------------------------------------------------------------------

# Both sources are hard-wrapped, so a phrase stated as one sentence is spread over two physical
# lines. Every assertion therefore runs against a FLATTENED region (newlines to spaces, runs of
# whitespace squeezed), which is what makes a check bind the statement rather than today's line
# breaks. A missing file yields an empty text, so its checks fail loudly instead of aborting.
flat() { { tr '\n' ' ' | tr -s ' '; } 2>/dev/null || true; }

# Drain the input even after a match. With pipefail, grep -q can close the pipe
# early and turn printf's SIGPIPE into a failed assertion on valid text.
has() { printf '%s' "$1" | grep -F -- "$2" >/dev/null; }
hasi() { printf '%s' "$1" | grep -iF -- "$2" >/dev/null; }
hasre() { printf '%s' "$1" | grep -E -- "$2" >/dev/null; }

# The MR-instruction REGION of bb-workflow: the paragraph that opens the MR,
# plus the block that follows it, ending at the next `##` heading. Isolating the region is what
# makes "AT the point where it instructs the subagent to open the MR" checkable — a mention
# anywhere else in the file must not satisfy it. Neither bound is a line number or a column, so
# renumbering the list or re-wrapping the prose leaves the region intact.
impl_mr_region() {
  { awk '
      /^Commit scoped work/ { f = 1 }
      f && /^## / { exit }
      f { print }
    ' "$IMPL" | flat; } 2>/dev/null || true
}

# The `## Merge` section of merge-mr, up to the next `##` heading. The gates live in their own
# section above it and are guarded separately, so a property stated among the gates cannot pass for
# a property of the merge call.
merge_section() {
  { awk '
      /^## Merge$/ { f = 1; next }
      f && /^## / { exit }
      f { print }
    ' "$MERGE" | flat; } 2>/dev/null || true
}

# The `## Gates` section keeps four numbered behavioral gates; emphasis is presentation.
gates_section() {
  { awk '
      /^## Gates/ { f = 1; next }
      f && /^## / { exit }
      f { print }
    ' "$MERGE"; } 2>/dev/null || true
}
gate_count() { gates_section | grep -c '^[0-9][0-9]*\. ' || true; }
four_gates() { [ "$(gate_count)" = "4" ]; }

check 'the working state discloses the delivery instructions' grep -qF '(delivery.md)' "$IMPL_ROOT"
check 'the bb-workflow delivery instructions exist' test -f "$IMPL"
check 'the merge reference exists' test -f "$MERGE"
check 'WORKFLOW.md exists' test -f "$WF"

IMPL_MR="$(impl_mr_region)"
MERGE_MR="$(merge_section)"
MERGE_GATES="$(gates_section | tr -d '*')"
MERGE_GATES_FLAT="$(printf '%s' "$MERGE_GATES" | flat)"
MERGE_INPUT="$({ awk '/^## Input/ { f = 1; next } f && /^## / { exit } f { print }' "$MERGE" | flat; } 2>/dev/null || true)"
WF_FLAT="$({ flat < "$WF"; } 2>/dev/null || true)"

check 'the MR-instruction region of bb-workflow is non-empty' test -n "$IMPL_MR"
check 'the ## Merge section of merge-mr is non-empty' test -n "$MERGE_MR"

# --- AC 1 — implement-ticket states target, squash and delete AT the MR instruction --------------
#
# The target check binds the PROPERTY — the MR is aimed at the ticket's `base_branch` field — and not
# one particular sentence saying so, and it binds it inside the block THIS ticket wrote. A second
# check used to pin eleven words of the build-order sentence above that block; that sentence is
# verbatim `origin/develop`'s and belongs to BB-392, whose own contract already asserts
# `glab mr create --target-branch <base_branch>` from it. Two contracts pinning literal text out of
# one sentence a third ticket owns is exactly how BB-274 and BB-392 collided, so the pin is gone
# rather than reworded: the property is asserted from prose this contract's ticket can keep true.

check 'AC-1 the MR region names base_branch as the target property' \
  hasre "$IMPL_MR" 'target is target_branch \(else base_branch\)'
check 'AC-1 the MR region names squash commits as enabled' \
  hasre "$IMPL_MR" 'Feature branches squash into one commit'
check 'AC-1 the MR region names delete source branch as enabled' \
  hasre "$IMPL_MR" 'delete only the ticket.s own short-lived branch'
check 'AC-1 the MR region says the properties are set on the MR itself, not left to a default' \
  hasi "$IMPL_MR" 'client defaults and project settings do not decide them'

# --- AC 2 — that instruction names no client: the forge tools carry it ---------------------------
#
# The MR is opened and merged through `bb-workflow/references/forge.md`'s tools, which send the
# target, method and deletion themselves; `skill-forge-commands.sh` keeps client command lines out
# of the skills. What stays checkable here is that the region routes through those operations and
# says the properties travel explicitly with the merge.

check 'AC-2 the MR region routes push and MR through the forge operations' \
  hasi "$IMPL_MR" 'push and create/update its MR'
check 'AC-2 the MR region requires explicit method and source deletion' \
  hasi "$IMPL_MR" 'Send method and source deletion explicitly'

# --- AC 3 — merge-mr states both as properties of the MERGE CALL ---------------------------------

check 'AC-3 the ## Merge section states squash as a property of this merge call' \
  hasi "$MERGE_MR" 'on this merge call'
check 'AC-3 the ## Merge section names squash commits' \
  hasi "$MERGE_MR" '**squash commits**'
check 'AC-3 the ## Merge section names delete source branch' \
  hasi "$MERGE_MR" '**delete source branch**'
# These three replace a pair that pinned the claim "the GitLab API defaults both to `false`". That
# claim was measurably wrong: `squash`/`squash_on_merge` and `force_remove_source_branch` are stored
# MR attributes — MR !395 of this project carries all three as `true` while the project's own
# `squash_option` is `default_off` — so a merge call that omits them inherits the stored values, not
# `false`. The instruction the claim justified is unchanged (send both on the call); what the checks
# now bind is the real mechanism, including the consequence: the negative has to be SENT, because
# omitting the field leaves the deletion to a value set elsewhere.
check 'AC-3 the ## Merge section requires both decisions explicitly on this call' \
  has "$MERGE_MR" 'Send **squash commits** and the **delete source branch** decision explicitly on this merge call;'
check 'AC-3 the ## Merge section says an omitted property inherits the MR stored value' \
  has "$MERGE_MR" 'omission inherits stored MR/project values.'
check 'AC-3 the ## Merge section says the negative is sent explicitly, not omitted' \
  has "$MERGE_MR" 'For retained sources, send the deletion negative explicitly.'
check 'AC-3 the ## Merge section says forge_merge guarantees its properties' \
  has "$MERGE_MR" '`forge_merge` guarantees every property in this section'

# --- AC 3 — unchanged-guards: this ticket adds no gate and touches no trailer --------------------
#
# AC 3 requires the four gates and the signature trailer to survive. These three checks are what
# makes "unchanged" a fact rather than an intention: the ticket explicitly rules out a fifth gate,
# and the trailer is what the release batch is computed from.

check 'AC-3 unchanged: exactly four numbered gates survive' four_gates
check 'AC-3 unchanged: explicit merge authorization is a caller input' \
  has "$MERGE_INPUT" 'Explicit merge authorization, obtained or reused by the caller.'
check 'AC-3 unchanged: gates block done' \
  grep -qF '## Gates (each a hard block on `done`)' "$MERGE"
check 'AC-3 unchanged: gate 1 MR link present' \
  hasre "$MERGE_GATES" '^1\. Resolvable MR link present\.'
check 'AC-3 unchanged: gate 2 Pipeline green' \
  hasre "$MERGE_GATES" '^2\. Pipeline green: latest MR pipeline succeeded, including required manual jobs\.'
check 'AC-3 unchanged: incomplete or failed required pipeline jobs block' \
  has "$MERGE_GATES_FLAT" 'including required manual jobs. Red, running or pending required jobs block.'
check 'AC-3 unchanged: gate 3 No merge conflict' \
  hasre "$MERGE_GATES" '^3\. No merge conflict; MR mergeable against its target\.'
check 'AC-3 unchanged: gate 4 Merge call succeeds' \
  hasre "$MERGE_GATES" '^4\. Merge call succeeds, followed by verified results below\.'
check 'AC-3 unchanged: the Merged-by: bakers.build trailer is still written' \
  has "$MERGE_MR" 'Merged-by: bakers.build'
# What AC 3 requires is that the signature trailer survives on the last line — not that it spells the
# bakers.build project key. It used to assert the literal `ref:bakers.build-<id>`, which BB-392 generalised to
# `ref:<identifier>` sourced from the ticket's own `identifier` field; two contracts asserting literal
# trailer text over the same prose region is what made these two tickets collide, so this one now
# binds the trailer's anchored POSITION and leaves the token to BB-267's contract, which owns it.
check 'AC-3 unchanged: the signature trailer is still anchored on the last line' \
  hasre "$MERGE_MR" 'final-line `ref:[^`]+` in the squash body'
check 'AC-3 unchanged: the merge result is still verified' \
  has "$MERGE_MR" 'Verify that the MR reports merged and its target advanced.'

# --- AC 8 — delete-source-branch never appears without its guard ---------------------------------
#
# Asserted over BOTH regions, because the option and its condition have to travel together. The
# condition is stated POSITIVELY — the source is the ticket's own work branch — and the long-lived
# names stay in the prose as EXAMPLES of what fails it. Deliberately not a name denylist: a denylist
# (`main|master|develop|stage`) misses `production`, `release/*`, `epic/*` and any customer's own
# convention, and it fails precisely in the release-branch case, where the name LOOKS short-lived
# but the branch must survive its own merge to be promoted.

check 'AC-8 bb-workflow ties the deletion to the ticket own branch_name' \
  hasre "$IMPL_MR" 'delete only the ticket.s own short-lived branch'
check 'AC-8 bb-workflow makes deletion conditional' \
  hasi "$IMPL_MR" 'delete only'
check 'AC-8 bb-workflow retains shared and environment branches' \
  hasi "$IMPL_MR" 'shared/environment branches'
check 'AC-8 bb-workflow names a reused release branch as failing the condition' \
  hasi "$IMPL_MR" 'promotion branches reused later'
check 'AC-8 bb-workflow names a branch other open MRs target as failing the condition' \
  hasi "$IMPL_MR" 'sources other open MRs target'
check 'AC-8 bb-workflow says why it is nevertheless always set here' \
  hasi "$IMPL_MR" "ticket's own short-lived branch"

check 'AC-8 merge-mr states the positive condition for deleting the source' \
  has "$MERGE_MR" "Delete only the merged ticket's own short-lived work branch."
check 'AC-8 merge-mr retains long-lived, shared and environment branches' \
  has "$MERGE_MR" 'Retain long-lived, shared and environment branches'
check 'AC-8 merge-mr retains release branches for later promotion' \
  hasre "$MERGE_MR" 'Retain [^.]*release branches a later promote reuses'
check 'AC-8 merge-mr retains branches other open MRs target as their base' \
  hasre "$MERGE_MR" 'Retain [^.]*branches that other open MRs target as their base\.'
check 'AC-8 merge-mr tells the agent to check the source rather than assume it' \
  has "$MERGE_MR" 'Check the source. Delete only'
check 'AC-8 merge-mr says the forge is not a backstop' \
  has "$MERGE_MR" 'Forge protection is not a substitute for this check.'
check 'AC-8 merge-mr sends the deletion negative on a source that fails the condition' \
  has "$MERGE_MR" 'For retained sources, send the deletion negative explicitly.'
check 'AC-8 merge-mr blocks forced deletion until the branch owner clears it' \
  has "$MERGE_MR" 'A stored `force_remove_source_branch: true` overrides this negative: block until the branch owner decides to clear it before merge.'
check 'AC-8 merge-mr retains squash when source deletion is disabled' \
  has "$MERGE_MR" 'clear it before merge. Keep squash enabled.'

# --- Consistency — the stated REASONS hold, not only the properties ------------------------------
#
# A file contract asserts that a property IS STATED and normally stops there, which is how the third
# review found what it found: the MR region stated both properties correctly and justified the squash
# with a mechanism that runs the other way — "no squash means no squash body and the ticket drops
# silently out of its release batch". It does not. `bakers deployment tickets` parses the whole range
# (`git log --format=%x1e%H %s%n%b <since>..<to>`, no `--first-parent`, `deployment.ts`), so an
# UNsquashed merge leaves every branch commit's own `ref:<identifier>` trailer inside the delta and
# the ticket IS in the batch. The squash is what discards those trailers, which is precisely why
# `references/merge.md` has to re-write one into the squash body. The same sentence also called the squash
# body "the only commit message a squash-merge puts on the target branch", which `merge-mr`'s own
# `--squash-message` paragraph contradicts for this project: `merge_method: merge` writes two. The
# corrected reason is stated as what the convention actually asks for — the branch lands as ONE commit
# — rather than as "no merge-commit history", which the two-commit fact above would undercut in turn.
#
# A wrong reason is not cosmetic in an instruction file. It is what a later editor consults when
# deciding whether the option may be dropped, and it is invisible to every other check here — so the
# corrected direction is asserted, over this ticket's own block and nowhere else.

check 'consistency: the MR region gives a squash reason that holds — the branch lands as one commit' \
  hasi "$IMPL_MR" 'into one commit'
check 'consistency: the MR region says the squash is what discards the per-commit trailers' \
  hasi "$MERGE_MR" 'Squash discards individual commit trailers'

# --- The stated source agrees with the two skills ------------------------------------------------
#
# `WORKFLOW.md` states the convention; the skills state how to satisfy it. These checks bind the two
# halves together, so the source cannot keep saying "squash-merged" while the skills have grown a
# second option — which is exactly the shape of the drift the whole ticket is about. The checks are
# deliberately few: `WORKFLOW.md` is the source of the RULE, not a second copy of the client forms.

check 'source: WORKFLOW.md states the MR targets the ticket base_branch' \
  hasi "$WF_FLAT" "targets the ticket's \`base_branch\`"
check 'source: WORKFLOW.md names squash commits as enabled on the MR' \
  hasi "$WF_FLAT" '**squash commits**'
check 'source: WORKFLOW.md names delete source branch as enabled on the MR' \
  hasi "$WF_FLAT" '**delete source branch**'
check 'source: WORKFLOW.md carries the positive condition for the deletion' \
  hasi "$WF_FLAT" "the source is the ticket's own short-lived work branch"
check 'source: WORKFLOW.md names a reused release branch as failing the condition' \
  hasi "$WF_FLAT" 'release branch a later promote reuses'
check 'source: WORKFLOW.md points at the two references that own the rule operationally' \
  hasre "$WF_FLAT" '`references/delivery.md` and `references/merge.md` own that rule'

# --- Result -------------------------------------------------------------------------------------

if [ "$failures" -ne 0 ]; then
  printf '\n%d check(s) failed\n' "$failures"
  exit 1
fi
printf '\nall checks passed\n'
