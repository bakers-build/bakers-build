#!/usr/bin/env bash
# bakers.build conductor CLI — standalone setup (bootstrap).
#
# Takes a FRESH CLONE to a working `bakers` CLI, with NO container runtime /
# worktree prerequisite. Idempotent: safe to re-run. Steps:
#   1. prereq check (pnpm, node >= 20.19)
#   2. install conductor dependencies
#   3. build conductor + workspace plugins
#   4. repo-root node_modules resolution farm (so .bakers/project.config.js
#      resolves its bare @bakers-build/* and @dropsh/* imports)
#   5. ~/.local/bin/bakers PATH shim (test-workspace-aware)
#   6. herdr run-session plugins (link the repo-local spiceedit plugin; best-effort)
#   7. summary / next steps (`bakers config init` writes the private connection)
#
# See bakers-cli/README.md for the full explanation.
set -euo pipefail

# Resolve the repo root from THIS script's own path (no git dependency), so the
# script works from a plain `bash bakers-cli/scripts/setup.sh`, from
# `pnpm run bootstrap`, or via an absolute path.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
CONDUCTOR_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
REPO_ROOT=$(cd "$CONDUCTOR_DIR/.." && pwd)

SECRET_ENV="BAKERS_CONSUMER_SECRET"

echo "==> bakers.build conductor setup"
echo "    repo root: $REPO_ROOT"

# --- 1. prerequisites ---------------------------------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
  cat >&2 <<'MSG'
ERROR: pnpm is not on your PATH.

Install it with one of:
  corepack enable pnpm        # ships with Node >= 16.9 (recommended)
  npm install -g pnpm

See https://pnpm.io/installation for details, then re-run this script.
MSG
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not on your PATH (Node >= 20.19 required)." >&2
  exit 1
fi

node_version=$(node --version | sed 's/^v//')
node_major=$(printf '%s' "$node_version" | cut -d. -f1)
node_minor=$(printf '%s' "$node_version" | cut -d. -f2)
if [ "$node_major" -lt 20 ] || { [ "$node_major" -eq 20 ] && [ "$node_minor" -lt 19 ]; }; then
  echo "ERROR: Node >= 20.19 required (found $node_version)." >&2
  exit 1
fi

# --- 2. install ---------------------------------------------------------------
# --config.minimumReleaseAge=0 mirrors the worktree `after_create` hook: it dodges the
# workspace supply-chain deps-verify policy that fails a plain install on a
# fresh tree.
echo "==> Installing conductor dependencies"
( cd "$CONDUCTOR_DIR" && pnpm install --config.minimumReleaseAge=0 )

# --- 3. build packages (core → conductor → addons → ui → bakers) ---------------
# `bakers-cli/bin/bakers` runs the compiled @bakers-build/conductor dist, and
# .bakers/project.config.js resolves the workspace packages whose exports point
# at dist/src. BB-215 reorg: the workspace is `core` (kernel) + `addons/*`
# (mountables) + `host` (CLI) + `conductor` (run engine). Invoke tsc directly (not
# `pnpm run build`) to stay fresh-tree-safe, same as the worktree `after_create` hook.
#
# ORDER MATTERS — it is the BB-224 layered dependency DAG, each step emitting
# the .d.ts the next one consumes:
#   1. `core`       the surface-agnostic kernel (no @bakers-build/* edge);
#   2. `conductor`  the run engine, which OWNS the conductor-surface contract
#                   (`@bakers-build/conductor/contract`) every conductor-surface addon
#                   imports — so it MUST precede the addons (this is the flip
#                   BB-224 introduced; the addons used to build before it);
#   3. `addons/*`   with `workspace-git` forced first, because `addon-herdr`
#                   takes `loadInstructions` from it (the one permitted
#                   addon→addon edge);
#   4. `ui`         imports `@bakers-build/addon-herdr`;
#   5. `host`       the leaf sink — imports `@bakers-build/ui/preset` + every addon.
echo "==> Building @bakers-build/core"
( cd "$CONDUCTOR_DIR" && node_modules/.bin/tsc -p core/tsconfig.json )

echo "==> Building @bakers-build/conductor (owns the conductor-surface contract)"
( cd "$CONDUCTOR_DIR" && node_modules/.bin/tsc -p conductor/tsconfig.json )

echo "==> Building addons"
ORDERED_ADDONS="workspace-git"
for addon_dir in "$CONDUCTOR_DIR"/addons/*/; do
  name=$(basename "$addon_dir")
  case " $ORDERED_ADDONS " in *" $name "*) continue ;; esac
  ORDERED_ADDONS="$ORDERED_ADDONS $name"
done
for name in $ORDERED_ADDONS; do
  [ -f "$CONDUCTOR_DIR/addons/$name/tsconfig.json" ] || continue
  echo "    - $name"
  ( cd "$CONDUCTOR_DIR" && node_modules/.bin/tsc -p "addons/$name/tsconfig.json" )
done

echo "==> Building @bakers-build/ui + @bakers-build/bakers"
( cd "$CONDUCTOR_DIR" && node_modules/.bin/tsc -p ui/tsconfig.json )
( cd "$CONDUCTOR_DIR" && node_modules/.bin/tsc -p host/tsconfig.json )

# --- 4. resolution farm -------------------------------------------------------
# Node ESM resolves the bare imports in .bakers/project.config.js by walking UP
# from .bakers/; a repo-root node_modules symlink farm is where it lands. This
# reproduces the mechanism a nested worktree relies on today. Idempotent
# (ln -sfn); node_modules/ is already gitignored. Each package is linked under
# its REAL package.json name (not a directory-derived one — @bakers-build/ui lives in
# addons/ but is NOT @bakers-build/addon-ui).
echo "==> Creating repo-root node_modules resolution farm"
mkdir -p "$REPO_ROOT/node_modules/@bakers-ai" "$REPO_ROOT/node_modules/@dropsh"

link_pkg() {
  # $1 = absolute package dir holding package.json
  [ -f "$1/package.json" ] || return 0
  pkg_name=$(node -e "process.stdout.write(require('$1/package.json').name)")
  case "$pkg_name" in
    @bakers-build/*) ln -sfn "$1" "$REPO_ROOT/node_modules/$pkg_name" ;;
  esac
}
link_pkg "$CONDUCTOR_DIR/core"
link_pkg "$CONDUCTOR_DIR/conductor"
link_pkg "$CONDUCTOR_DIR/host"
link_pkg "$CONDUCTOR_DIR/ui"
for addon_dir in "$CONDUCTOR_DIR"/addons/*/; do
  link_pkg "${addon_dir%/}"
done

if [ -d "$CONDUCTOR_DIR/node_modules/@dropsh" ]; then
  for dropsh_pkg in "$CONDUCTOR_DIR"/node_modules/@dropsh/*/; do
    [ -e "$dropsh_pkg" ] || continue
    name=$(basename "$dropsh_pkg")
    ln -sfn "$CONDUCTOR_DIR/node_modules/@dropsh/$name" "$REPO_ROOT/node_modules/@dropsh/$name"
  done
fi

# --- 5. PATH shim -------------------------------------------------------------
# A test-workspace-aware `bakers` on PATH (BB-390). Two tiers: inside a
# `.bakers-testbuild` workspace — the skill-test project `scripts/setup-test-project.sh`
# creates, recognised by a marker file at or above the working directory — it runs
# the checkout that marker names, failing loudly if that checkout is unbuilt;
# EVERYWHERE ELSE, a plain bakers checkout included, it runs the globally-installed
# bakers. It used to key on the git toplevel instead, which made an unbuilt or broken
# branch build break every unrelated `bakers` command in that worktree; to exercise a
# checkout's build now, call `./bakers-cli/bin/bakers` by explicit path.
#
# The template is installed verbatim: nothing is substituted into it, and no clone
# path is baked in. Never clobber a differing existing shim — it is a machine-global
# executable the operator may have edited, so a NEW shim does not reach an existing
# install by re-running this script. The WARN below prints the adoption command
# literally for that reason.
echo "==> Installing ~/.local/bin/bakers PATH shim"
LOCAL_BIN="$HOME/.local/bin"
SHIM_SRC="$CONDUCTOR_DIR/templates/bakers.pathshim.sh"
SHIM_DST="$LOCAL_BIN/bakers"
mkdir -p "$LOCAL_BIN"
if [ -e "$SHIM_DST" ] || [ -L "$SHIM_DST" ]; then
  if cmp -s "$SHIM_SRC" "$SHIM_DST"; then
    echo "    up to date"
  else
    echo "    WARN: $SHIM_DST already exists and differs — leaving it untouched." >&2
    echo "          Nothing here overwrites it, so a NEW shim does not reach this install by" >&2
    echo "          re-running setup.sh. To adopt the canonical one, run exactly:" >&2
    echo "            cp \"$SHIM_SRC\" \"$SHIM_DST\" && chmod 0755 \"$SHIM_DST\"" >&2
    echo "          (diff first if you have edited it: diff \"$SHIM_DST\" \"$SHIM_SRC\")" >&2
  fi
else
  cp "$SHIM_SRC" "$SHIM_DST"
  chmod 0755 "$SHIM_DST"
  echo "    installed"
fi

case ":$PATH:" in
  *":$LOCAL_BIN:"*) : ;;
  *)
    echo "    WARN: $LOCAL_BIN is not on your PATH. Add it:" >&2
    echo "          export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2
    ;;
esac

# BB-84: even when ~/.local/bin IS on PATH, a globally-installed `bakers`
# (npm -g @bakers-build/bakers, in the active node's bin dir) that sits AHEAD of it
# defeats the shim — `bakers` then runs the published global even inside a
# `.bakers-testbuild` workspace, where the build under test is what must run. Warn on
# that PATH-order shadow so the shim is actually reachable.
node_bin_path=$(command -v node 2>/dev/null || true)
if [ -n "$node_bin_path" ]; then
  node_bin_dir=$(dirname "$node_bin_path")
  if [ -x "$node_bin_dir/bakers" ] && [ "$node_bin_dir" != "$LOCAL_BIN" ]; then
    # Walk PATH: whichever of the two dirs appears first wins. Warn only when
    # the global's dir precedes ~/.local/bin.
    IFS=':'
    for dir in $PATH; do
      if [ "$dir" = "$node_bin_dir" ]; then
        echo "    WARN: a global 'bakers' in $node_bin_dir precedes $LOCAL_BIN on PATH —" >&2
        echo "          the test-workspace-aware shim is shadowed. Put ~/.local/bin first:" >&2
        echo "          export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2
        break
      fi
      [ "$dir" = "$LOCAL_BIN" ] && break
    done
    unset IFS
  fi
fi

# --- 6. herdr run-session plugins (spiceedit) ---------------------------------
# BB-58: in the review run-session the diff surface is hunk (BB-55) — opt-in,
# agent-driven, in the human's interactive pane, not an executor-forced pane.
# Clicking a changed file there opens a spiceedit overlay. spiceedit is exposed to
# herdr via the repo-local `herdr/spiceedit` plugin. Both are herdr-global (once per
# host) and BEST-EFFORT: herdr is the executor, not a hard conductor-CLI prereq,
# and a missing tool degrades gracefully at run time — so nothing here fails the
# bootstrap.
echo "==> Registering herdr run-session plugins (best-effort)"
if command -v herdr >/dev/null 2>&1; then
  # Link the repo-local spiceedit plugin. Idempotent: re-linking the same path is
  # a no-op; a failure (already linked / older herdr) must not fail setup.
  herdr plugin link "$REPO_ROOT/herdr/spiceedit" >/dev/null 2>&1 \
    && echo "    linked herdr plugin: spiceedit" \
    || echo "    spiceedit herdr plugin already linked or link skipped"
  if ! command -v spiceedit >/dev/null 2>&1; then
    echo "    NOTE: spiceedit binary not found — the review click-to-edit overlay" >&2
    echo "          degrades to a message until it is installed (needs Go 1.22+)." >&2
  fi
else
  echo "    herdr not on PATH — skipping (only needed for the herdr executor)."
fi

# --- 7. summary ---------------------------------------------------------------
cat <<MSG

==> bakers.build conductor CLI ready.

Next steps:
  1. Export your OAuth consumer secret (never committed):
       export $SECRET_ENV=<your consumer secret>
  2. Write your private connection (~/.bakers/connections/default.js) and machine file:
       bakers config init
  3. Authenticate and verify:
       bakers auth login && bakers auth status

Re-run this script (or: pnpm run bootstrap) any time — it is idempotent.
MSG
