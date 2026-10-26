#!/usr/bin/env bash
set -euo pipefail

# BB-267 — the commit-message convention: a conventional-commit subject scoped by the ORIGIN
# reference, an optional proportional body, and `ref:<identifier>` as the very last line.
#
# BB-392 corrected three defects this contract had frozen in place, so the checks below bind the
# corrected rule: the trailer is the ticket's `identifier` FIELD (which already carries the project
# key — `SHOP-42` yields `ref:SHOP-42`), not a literal `bakers.build-` prefix plus a number; the squash body
# is written with `--squash-message`, because `glab mr merge --message` sets the MERGE commit and
# leaves the squash commit — the one that represents the change — with GitLab's default template;
# and the MR is targeted at the ticket's computed `base_branch` rather than a hardcoded `develop`.
#
# Why a file contract is the honest gate here. Nothing in this repository executes the convention.
# The commit message is written by an agent following prose, and the squash merge is a `glab` call
# made on that agent's machine with that machine's credentials — there is no code path to unit-test,
# and a mocked substitute would assert nothing about the real one. What CAN drift is the prose, and
# it can drift silently: the rule lives in THREE sources that must agree (`docs/bakers/git-and-delivery.md`,
# the `bb-workflow` state flows and its `references/merge.md`), and the failure it guards against produces no error
# anywhere — `bakers deployment tickets` reports only identifiers it found but could not resolve, so a
# merged commit carrying no ticket identifier yields no entry at all and the ticket just disappears
# from the release batch. So the gate is a contract over the three prose sources plus two ties to
# the parser that consumes the trailer.
#
# This script is run by `bakers-cli/core/tests/workflow/commit-convention.test.ts`, so it fails
# `pnpm --filter @bakers-build/core test` — hence CI — rather than being a gate in name only.
#
# Runs on bash 3.2 (macOS `/bin/bash`): no `mapfile`, no `declare -A`. No `python3`.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The convention text moved out of WORKFLOW.md (whose Standards section is pointers only) into
# docs/bakers/git-and-delivery.md; that note is now the stated source this contract binds.
WF="$ROOT/docs/bakers/git-and-delivery.md"
MERGE="$ROOT/.claude/skills/bakers-build/skills/bb-workflow/references/merge.md"
IMPL="$ROOT/.claude/skills/bakers-build/skills/bb-workflow/references/working.md"
DEPLOY="$ROOT/bakers-cli/addons/deployment/src/deployment.ts"
# The recipe must leave the merge call to the frame's single call sites, because the trailer
# input added below is **required**: a call site that names only the MR link leaves the skill to
# guess, and the failure mode this whole ticket exists to prevent is a silent one.
RECIPE="$ROOT/.claude/skills/bakers-build/skills/bb-recipe-matt/SKILL.md"
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then printf 'PASS %s\n' "$label"; else printf 'FAIL %s\n' "$label"; failures=$((failures + 1)); fi
}

# --- Helpers ------------------------------------------------------------------------------------

# The prose sources are hard-wrapped, so a phrase the convention states as one sentence is spread
# over two physical lines. Every prose assertion therefore runs against a FLATTENED copy (newlines
# to spaces, runs of whitespace squeezed), which is what makes the checks bind the statement rather
# than the current line breaks. A missing file yields an empty text, so its checks fail loudly
# instead of aborting the run.
flatten() { { tr '\n' ' ' < "$1" | tr -s ' '; } 2>/dev/null || true; }

# Same, with Markdown emphasis removed — used only where two sources state the same rule with
# different bolding.
plain() { flatten "$1" | tr -d '*'; }

has() { printf '%s' "$1" | grep -qF -- "$2"; }
hasi() { printf '%s' "$1" | grep -qiF -- "$2"; }
hasre() { printf '%s' "$1" | grep -qE -- "$2"; }
# A phrasing that must be GONE. Used where the correction removed a statement rather than adding
# one, so its absence is the whole assertion and a re-added sentence has to fail.
absent() { ! printf '%s' "$1" | grep -qF -- "$2"; }

# The same literal must appear in every one of the given texts — the cross-source agreement AC-5
# exists for.
agree() {
  local needle="$1"
  shift
  local text
  for text in "$@"; do
    printf '%s' "$text" | grep -qF -- "$needle" || return 1
  done
}

# `step-contract.test.ts` asserts `/standards/i` matches no SKILL.md in the tree (a BB-262 guard).
# Both skills edited here say "convention" instead; guard it at the source so a well-meaning edit
# does not fail the whole core suite with an unrelated-looking error.
no_standards() { ! grep -qi 'standards' "$1"; }
no_has() { ! grep -qF -- "$2" "$1"; }

# `glab mr merge` accepts BOTH `-m/--message` and `--squash-message`, and they write different
# commits: with a merge method that produces a merge commit, `--message` sets that one and leaves
# the squash commit — the commit that represents the change — with GitLab's default template, the MR
# title, which by this convention carries no reference at all. The positive check below pins
# `--squash-message`; this one pins the absence of the flag that silently does the wrong thing, so a
# revert to `--message` cannot pass by also happening to mention the right flag in prose.
squash_flag_not_message() { ! printf '%s' "$MERGE_COMMAND" | grep -E -- '(^| )(-m|--message)( |$)' >/dev/null; }

check 'WORKFLOW.md exists' test -f "$WF"
check 'the merge reference exists' test -f "$MERGE"
check 'the working state file exists' test -f "$IMPL"
check 'the deployment addon source exists' test -f "$DEPLOY"

WF_FLAT="$(flatten "$WF")"
MERGE_FLAT="$(flatten "$MERGE")"
MERGE_COMMAND="$({ awk '/^glab mr merge / { f = 1 } f && /^```/ { exit } f { print }' "$MERGE" | tr '\n' ' ' | tr -s ' '; } 2>/dev/null || true)"
for reference in coding-gate delivery; do
  check "the working state discloses $reference" grep -qF "($reference.md)" "$IMPL"
done
IMPL_FLAT="$(for reference in coding-gate review delivery; do flatten "$(dirname "$IMPL")/$reference.md"; done)"
WF_PLAIN="$(plain "$WF")"
IMPL_PLAIN="$(plain "$IMPL")"
MERGE_PLAIN="$(plain "$MERGE")"
DEPLOY_TEXT="$(flatten "$DEPLOY")"

# The declared-input region of merge-mr, so the identifier counts as an INPUT rather than a mention
# somewhere else in the body.
MERGE_INPUT="$({ awk '/^## Input/ { f = 1; next } f && /^## / { exit } f { print }' "$MERGE" | tr '\n' ' ' | tr -s ' '; } 2>/dev/null || true)"
MERGE_INPUT_PLAIN="$(printf '%s' "$MERGE_INPUT" | tr -d '*')"

# --- AC-1 — WORKFLOW.md states the three-part format ---------------------------------------------

check 'AC-1 WORKFLOW.md shows the subject shape <type>(<origin-ref>): <short imperative subject>' \
  has "$WF_FLAT" '<type>(<origin-ref>): <short imperative subject>'
check 'AC-1 WORKFLOW.md shows the trailer literal ref:<identifier>' \
  has "$WF_FLAT" 'ref:<identifier>'
check 'AC-1 WORKFLOW.md states the trailer is the very last line' \
  hasi "$WF_FLAT" 'always the very last line'
check 'AC-1 WORKFLOW.md names the GitLab origin-ref notation <project>#<issueID>' \
  has "$WF_FLAT" '<project>#<issueID>'
check 'AC-1 WORKFLOW.md carries the worked example bakers#123' \
  has "$WF_FLAT" '(`bakers#123`)'
check 'AC-1 WORKFLOW.md derives the scope from the ticket origin URL' \
  has "$WF_FLAT" '<base>/<project-path>/-/issues/<iid>'
check 'AC-1 WORKFLOW.md names the full namespace form bakers-build/bakers-build#123' \
  has "$WF_FLAT" 'bakers-build/bakers-build#123'
check 'AC-1 WORKFLOW.md uses the namespace form ONLY to disambiguate' \
  hasre "$WF_FLAT" 'only[^.]*disambiguat'
check 'AC-1 WORKFLOW.md omits the scope entirely without an origin issue' \
  has "$WF_FLAT" 'omits the scope entirely'
check 'AC-1 WORKFLOW.md shows the no-origin example chore: <subject>' \
  has "$WF_FLAT" 'chore: <subject>'
check 'AC-1 WORKFLOW.md calls the body optional and proportional' \
  has "$WF_FLAT" 'body is optional and stays proportional'
check 'AC-1 WORKFLOW.md sources the trailer from the ticket identifier FIELD' \
  has "$WF_FLAT" "ticket's own \`identifier\` field"
check 'AC-1 WORKFLOW.md says the value is copied verbatim in its canonical casing' \
  has "$WF_FLAT" 'copied verbatim in its'
check 'AC-1 WORKFLOW.md forbids composing the trailer from a literal prefix plus a number' \
  hasi "$WF_FLAT" 'never a literal prefix plus a number'
check 'AC-1 WORKFLOW.md carries a NON-bakers.build worked example (SHOP-42 -> ref:SHOP-42)' \
  has "$WF_FLAT" 'ref:SHOP-42'

# --- AC-2 — WORKFLOW.md states the merge-request rule --------------------------------------------

check 'AC-2 WORKFLOW.md: an MR title and description carry no bakers.build reference' \
  hasre "$WF_FLAT" 'merge request title and description carry \*\*no bakers.build reference\*\*'
check 'AC-2 WORKFLOW.md states that rule holds without exception' \
  hasi "$WF_FLAT" 'without exception'
check 'AC-2 WORKFLOW.md targets the MR at the ticket base_branch, passed explicitly' \
  has "$WF_FLAT" 'glab mr create --target-branch <base_branch>'
check 'AC-2 WORKFLOW.md no longer hardcodes develop as the MR target' \
  absent "$WF_FLAT" 'merge request against `develop`'

# --- AC-3 — merge-mr writes the trailer into the squash body -------------------------------------

check 'AC-3 merge-mr declares the ticket identifier FIELD as an input' \
  has "$MERGE_INPUT" '`identifier` field'
check 'AC-3 that input is marked Required' \
  hasre "$MERGE_INPUT_PLAIN" 'Required: the calling ticket.s `identifier` field'
check 'AC-3 the squash message writes the trailer LAST, after the signature' \
  grep -qF "printf '%s\n\n%s\n%s' '<subject>' 'Merged-by: bakers.build' 'ref:<identifier>'" "$MERGE"
check 'AC-3 the merge sets the SQUASH commit message (--squash-message)' \
  hasre "$MERGE_COMMAND" '--squash-message "\$\(printf'
check 'AC-3 the merge does NOT set the merge-commit message (-m/--message) instead' \
  squash_flag_not_message
check 'AC-3 merge-mr explains that --message would write the wrong commit' \
  has "$MERGE_FLAT" '`-m`/`--message` sets the merge commit, not the squash commit representing the change.'
check 'AC-3 merge-mr sources the trailer from the ticket identifier FIELD, verbatim' \
  hasre "$MERGE_INPUT_PLAIN" 'ticket.s `identifier` field, verbatim in canonical casing'
check 'AC-3 merge-mr forbids constructing the trailer project prefix' \
  has "$MERGE_INPUT_PLAIN" 'Never construct a project prefix: `SHOP-42` becomes `ref:SHOP-42`.'
check 'AC-3 merge-mr carries a NON-bakers.build worked example (SHOP-42 -> ref:SHOP-42)' \
  has "$MERGE_FLAT" 'ref:SHOP-42'
check 'AC-3 merge-mr says the subject comes from the MR title' \
  has "$MERGE_FLAT" 'comes from the MR title'
check 'AC-3 merge-mr says that MR title carries no bakers.build reference (so it cannot supply it)' \
  has "$MERGE_FLAT" 'MR title, which carries no bakers.build reference'
check 'AC-3 merge-mr says the squash discards each commit trailer' \
  has "$MERGE_FLAT" 'Squash discards individual commit trailers'
check 'AC-3 merge-mr names the loss as silent' \
  has "$MERGE_FLAT" 'final-line `ref:<identifier>` in the squash body; otherwise release measurement silently loses the ticket.'
check 'AC-3 merge-mr says convention, never the word the skill guard forbids' \
  no_standards "$MERGE"

# --- AC-3 — every call site actually passes that required input ----------------------------------
#
# A required input nothing passes is a required input in name only. The invoking agent does read
# merge-mr's own frontmatter, so this is a belt-and-braces guard rather than the only defence — but
# the loss it prevents produces no error anywhere, so "probably passed" is not good enough.

# The coding-side merge-mr call site lives once in the frame's Coding gate; the recipe references
# the gate instead of calling merge-mr, so assert the gate's own call site.
check 'AC-3 the recipe does not call merge-mr directly (single-sourced in Coding gate)' \
  no_has "$RECIPE" 'merge.md'
check 'AC-3 the Coding gate merge-mr call names the ticket `identifier` field' \
  hasre "$IMPL_FLAT" 'runs \[merge\]\(merge\.md\) with the ticket.s .identifier. field'
# BB-444: the review merge-mr call site moved out of review-ticket into the shared
# bb-workflow › Review flow (review-ticket is the credential-less verdict helper and calls no
# merge). Assert the flow's call site names the `identifier` field.
check 'AC-3 the Review flow merge-mr call names the ticket `identifier` field' \
  hasre "$IMPL_FLAT" 'run \[merge\]\(merge\.md\) with the ticket.s .identifier. field once'

# --- AC-4 — shared coding context reaches the project convention ------------------------------

check 'AC-4 coding context points at project commit and MR conventions' \
  has "$IMPL_FLAT" 'Follow project commit and MR conventions'
check 'AC-4 coding context requires an explicit base_branch MR target' \
  has "$IMPL_FLAT" '--target-branch <base_branch>'

# --- D6 — the convention is compatible with the release-batch parser -----------------------------
#
# The parse used to be a single regex whose text could be lifted out of the addon and re-run from
# bash, which is how earlier revisions of this contract asked "does the parser still see the trailer
# this convention documents?". BB-392 generalised it into a two-pass admitted-key scan
# (`parseIdentifiers`): a key is admitted where it stands in an anchored position — the `ref:`
# trailer, a conventional-commit scope, a subject-leading reference — and identifiers of admitted
# keys are then collected. That is no longer expressible as one grep, and the question it answered is
# now answered better, against the real function, by
# `bakers-cli/addons/deployment/tests/deployment.test.ts` (`ref:SHOP-42` -> `SHOP-42`). What is left
# for a PROSE contract is the drift this file exists to catch: that the parser has not been re-keyed
# to `bakers.build` alone, and that WORKFLOW.md does not promise a parse the addon does not perform.

check 'D6 the deployment parse is NOT hardcoded to the bakers.build key' \
  absent "$DEPLOY_TEXT" '\bbakers.build-\d+\b'
check 'D6 the deployment parse admits any project key shape [A-Z][A-Z0-9]{1,9}' \
  has "$DEPLOY_TEXT" '[A-Z][A-Z0-9]{1,9}'
check 'D6 the deployment parse anchors on the ref: trailer this convention prescribes' \
  has "$DEPLOY_TEXT" 'ref:'
check 'D6 WORKFLOW.md describes that admitted-key parse rather than a bakers.build-only one' \
  hasi "$WF_FLAT" 'admits any project key'
check 'D6 WORKFLOW.md names the anchored position that admits a key' \
  hasi "$WF_FLAT" 'anchored position'

# --- Cross-source agreement: the convention remains owned by WORKFLOW.md ----------------------

check 'workflow and merge instructions carry ref:<identifier>' \
  agree 'ref:<identifier>' "$WF_FLAT" "$MERGE_FLAT"
check 'workflow and merge instructions name the ticket identifier field' \
  agree '`identifier` field' "$WF_PLAIN" "$MERGE_PLAIN"
check 'workflow and merge instructions carry the non-bakers.build example' \
  agree 'ref:SHOP-42' "$WF_FLAT" "$MERGE_FLAT"

# --- Result -------------------------------------------------------------------------------------

if [ "$failures" -gt 0 ]; then
  printf '\n%d check(s) FAILED\n' "$failures"
  exit 1
fi
printf '\nall checks passed\n'
