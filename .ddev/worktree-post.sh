#!/bin/bash
# bakers.build worktree bootstrap (BB-142) — the project-owned `init.worktree_post` step.
#
# The keytec-ddev-addon's `ddev init-worktree` runs `init.worktree_post` as its final step, in
# the worktree root, with DDEV_WORKTREE_NAME exported. This logic used to live in bakers's local
# `init-worktree`; it now lives here and `.keytec-ai.yml` points `worktree_post` at this script.
#
# It MUST be a script (not an inline `worktree_post:` string): keytec-ai surfaces worktree_post via
# `config to-env` as INIT_WORKTREE_POST, which `ddev init` eval-loads under `set -u` — an inline
# value containing `$(...)`/`${var}` would be command-substituted / hit an unbound var at that
# eval and break `ddev init`. A plain `bash .ddev/worktree-post.sh` invocation is eval-safe; all
# the real logic (command substitutions, variable refs) stays here and runs verbatim.
#
# Invoked TWICE, deliberately (BB-142, review finding #2 — no npx fallback):
#   1. by the addon's `ddev init-worktree` via INIT_WORKTREE_POST — but ONLY when it could resolve
#      INIT_WORKTREE_POST, which needs `keytec-ai`/`npx` reachable on the host. On a host lacking
#      BOTH the addon silently skips the post step (it cannot tell "no post-step configured" from
#      "post-step configured but not surfaced").
#   2. explicitly by the conductor `after_create` hook (`.bakers/conductor.config.js`) as a
#      belt-and-suspenders, so the bootstrap runs regardless of host tooling.
# The sentinel below makes the second invocation a cheap, loud no-op so the pair never repeats the
# work.
#
# WHAT IT DOES (BB-390): copy the parent's `.bakers` client config and point it at this worktree's
# own DDEV, then hand the rest to `scripts/setup-test-project.sh --workspace-only`. It no longer
# carries a build of its own — the build moved to the script that consumes it, which performs one
# only when a dist artifact is missing or stale. On a FRESH worktree that probe always fires
# (`dist/` is gitignored, so a new checkout has none) and the full monorepo build still runs once —
# it has to, because the workspace links THIS checkout's build. What the move buys is a single
# owner for the build and a cheap re-run on an already-built worktree, NOT a cheaper first
# bootstrap. Nothing here starts a DDEV.
set -e

SENTINEL=".bakers/.worktree-post-done"
if [ -f "${SENTINEL}" ]; then
  echo "==> bakers worktree bootstrap already done (${SENTINEL}); skipping. Delete it to force a rebuild." >&2
  exit 0
fi

echo "==> bakers worktree bootstrap (init.worktree_post) — copy parent .bakers config + test setup"

# Copy the conductor client config (oauth client_secret etc.) from the parent worktree so
# `bakers dropsh` auth works here without a manual re-login. It is gitignored (holds the secret),
# so a fresh worktree checkout never has it.
#
# BB-154: the parent config carries the parent's base_url (the shared project control plane,
# e.g. dev2). Inheriting it means a `bakers oven start` run in the worktree registers against
# that shared plane and races the main conductor's claim pool (duplicate-identity pile-up). So we
# point the copied config at THIS worktree's OWN local DDEV site instead — the worktree conductor
# is then isolated to its own site and never contends for the shared pool. init-worktree exports
# DDEV_WORKTREE_NAME and writes PLAYWRIGHT_BASE_URL into .env.ddev; either yields the local URL.
#
# BB-237: the copy and the rewrite are two SEPARATE convergent steps. They used to share one
# `[ ! -f .bakers/conductor.config.local.js ]` gate, so the base_url rewrite only ever ran on the
# very first copy — re-running the bootstrap in a worktree that already had the config copied
# (every worktree damaged by the BB-237 perl abort) wrote the sentinel but silently left the
# parent's shared base_url in place. Copy-when-missing; then ensure the worktree-local base_url is
# present-and-winning either way, idempotently (see the marker below).
PARENT_PATH=$(git worktree list | head -1 | awk '{print $1}')
PARENT_BB_LOCAL="${PARENT_PATH}/.bakers/conductor.config.local.js"
if [ -n "${PARENT_PATH}" ] && [ -f "${PARENT_BB_LOCAL}" ]; then
  mkdir -p .bakers
  if [ ! -f .bakers/conductor.config.local.js ]; then
    cp "${PARENT_BB_LOCAL}" .bakers/conductor.config.local.js
    echo "Copied conductor client config from parent (.bakers/conductor.config.local.js)"
  fi

  # The operator's declared audience (`@bakers-build/method-context` › Audience and register) is
  # uncommitted by design, so a fresh worktree would start without it and every dispatched
  # run there would fall back to the neutral default. Same copy-when-missing rule as above:
  # a worktree that already carries one has been set up deliberately and is left alone.
  PARENT_AUDIENCE="${PARENT_PATH}/.bakers/audience.local.md"
  if [ -f "${PARENT_AUDIENCE}" ] && [ ! -f .bakers/audience.local.md ]; then
    cp "${PARENT_AUDIENCE}" .bakers/audience.local.md
    echo "Copied operator audience declaration from parent (.bakers/audience.local.md)"
  fi

  WORKTREE_URL=""
  if [ -f .env.ddev ]; then
    WORKTREE_URL=$(grep -E '^PLAYWRIGHT_BASE_URL=' .env.ddev | head -1 | cut -d= -f2-)
  fi
  if [ -z "${WORKTREE_URL}" ] && [ -n "${DDEV_WORKTREE_NAME:-}" ]; then
    WORKTREE_URL="https://${DDEV_WORKTREE_NAME}.ddev.site"
  fi
  if [ -n "${WORKTREE_URL}" ]; then
    # Append base_url as the last key of the exported config object so it wins even when the
    # inherited parent config already has a top-level base_url key.
    #
    # BB-237 — the perl program is SINGLE-quoted and the URL arrives via the environment
    # ($ENV{...}), so bash never touches the regex. It previously lived in a DOUBLE-quoted bash
    # string, where bash expanded the end anchor `$#` (the positional-argument count) to `0`
    # before perl saw it: the s### lost its closing delimiter, perl died with "Substitution
    # replacement not terminated" (exit 255), and `set -e` aborted the script two lines before
    # `touch "${SENTINEL}"`. Escaping `\$#` would fix that one character; zero interpolation
    # makes the whole class of bug impossible, and `\z` is an unambiguous end-of-string anchor.
    #
    # Idempotent by marker: our own appended line is tagged, so each run first DROPS the line it
    # wrote last time and then appends a fresh one. Convergent (a damaged worktree gets repaired)
    # without stacking a duplicate key on every bootstrap.
    BB_WORKTREE_URL="${WORKTREE_URL}" perl -0pi -e '
      my $marker = " // BB-154 worktree-local base_url";
      s/\n[ \t]*base_url:[^\n]*\Q$marker\E(?=\n)//g;
      my $url = $ENV{BB_WORKTREE_URL};
      s/,?\s*\};\s*\z/,\n  base_url: '"'"'$url'"'"',$marker\n};\n/;
    ' .bakers/conductor.config.local.js
    echo "Set worktree-local base_url ${WORKTREE_URL} in .bakers/conductor.config.local.js (BB-154)"
  else
    echo "WARN: could not resolve worktree-local base_url (neither PLAYWRIGHT_BASE_URL in .env.ddev" >&2
    echo "      nor DDEV_WORKTREE_NAME was set); .bakers/conductor.config.local.js keeps the inherited" >&2
    echo "      parent base_url — this worktree's conductor would contend for the shared claim pool." >&2
    echo "      Fix: run 'ddev init-worktree' (writes .env.ddev), then delete ${SENTINEL} and re-run." >&2
  fi
fi

# The test setup (BB-390). This replaces the unconditional `pnpm install && pnpm -r run build`
# this script used to carry: `--workspace-only` builds only when a dist artifact is missing or older
# than its sources, and it is the workspace, not the checkout, where that build is exercised. Read
# that as "the build has exactly one owner", NOT as "a fresh worktree stopped paying for it" — a
# fresh worktree has no `dist/` at all, so it builds once here just as it did before.
#
# `--workspace-only` is what makes this affordable AND safe. It checks the fixture repo out, writes
# the workspace DDEV overlay WITHOUT starting it, links this checkout's packages and skills, and
# drops the `.bakers-testbuild` marker that makes a bare `bakers` in the workspace this checkout's
# build. It provisions no world and writes nothing to the control plane — in particular it never
# runs `ddev init --provider recipe-test`, which would wipe the database `ddev init-worktree` has
# just built and replace this branch's site with the e2e world.
#
# HARD-FAIL WITHOUT THE SENTINEL, same contract as the old build step: on failure the sentinel is
# not written, so the next `ddev init-worktree` (or the conductor's `after_create`) retries instead
# of skipping. It runs AFTER the config copy and base_url rewrite above so the workspace inherits a
# working auth context.
#
# PREREQUISITE, and it is NEW with BB-390 — provision it, do not discover it. `--workspace-only`
# clones (or fetches) the fixture repo `git@git.key-tec.de:keytec-ai-test/bakers-playground.git` over
# SSH, so this bootstrap now needs a key with read access to `keytec-ai-test/*` plus network reach
# to that host; before BB-390 it needed only the npm registry. Combined with the hard-fail above,
# a host without that access fails `ddev init-worktree` — and through `after_create` in
# `.bakers/conductor.config.js`, fails conductor worktree creation and kills the run. Failing loudly
# is the deliberate choice over a soft skip, because a skipped setup leaves a worktree that looks
# provisioned and is not.
if [ -f scripts/setup-test-project.sh ]; then
  echo "==> Setting up the test workspace (scripts/setup-test-project.sh --workspace-only)"
  if ! bash scripts/setup-test-project.sh --workspace-only; then
    echo "ERROR: the test workspace setup failed. Fix it, then re-run 'ddev init-worktree'" >&2
    echo "       (or manually: bash scripts/setup-test-project.sh --workspace-only)" >&2
    exit 1
  fi
fi

mkdir -p .bakers
touch "${SENTINEL}"
echo "==> bakers worktree bootstrap complete (sentinel ${SENTINEL} written)"
