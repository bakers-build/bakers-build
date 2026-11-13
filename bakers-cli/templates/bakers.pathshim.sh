#!/usr/bin/env sh
# bakers shim — select a checkout's own conductor build where that build is under
# TEST, and the released CLI everywhere else, regardless of shell. Lives in
# ~/.local/bin (ahead of the nvm global on PATH), so it shadows the
# globally-linked bakers in bash, fish, and the Claude Code ! runner alike.
#
# Resolution order:
#   1. A TEST-SETUP WORKSPACE — a `.bakers-testbuild` marker file at or above the
#      physical working directory, holding the absolute path of the bakers
#      checkout that created the workspace (written by
#      .bakers/scripts/setup-test-project.sh). That checkout's OWN build is then
#      authoritative: the compiled `bakers-cli/conductor/dist/src/index.js` is
#      required, and a missing/broken build FAILS LOUDLY (exit 1) with a build
#      hint;
#   2. THE GLOBALLY-INSTALLED bakers — everywhere else, a plain bakers checkout
#      INCLUDED.
#
# Why tier 1 is scoped to the workspace (BB-390). It used to fire on
# `git rev-parse --show-toplevel` holding an executable `bakers-cli/bin/bakers`, i.e.
# anywhere inside the bakers repo or any of its worktrees. Two costs, both
# measured: every worktree had to carry a full CLI build before any unrelated
# `bakers` command worked in it, and a CLI change in the branch broke that
# worktree's own tooling (a required config key added on a branch made
# `bakers tools` unusable for reading the very ticket being worked on). The
# workspace is where the branch build is actually exercised, and now the only
# place it is selected. Inside a checkout, run `./bakers-cli/bin/bakers` by explicit
# path to exercise that build.
#
# Why the walk is over the FILESYSTEM and not over git. The conductor's
# `checkoutRoot` is the directory of its config (`<workspace>/.bakers`), so its
# per-ticket worktrees land at `<workspace>/.bakers-worktrees/<branch>` — INSIDE
# the workspace. A git-based lookup stops at such a worktree's own toplevel and
# never sees the marker two levels up; a filesystem walk passes straight through
# it. It is also cheaper than the `git rev-parse` fork it replaces: one `[ -f ]`
# per level, and `bakers` is invoked constantly.
#
# Why an unbuilt checkout FAILS instead of falling through to tier 2. The
# workspace is the one place whose purpose is to run the build under test.
# Handing it a different `bakers`, silently, is the worst available outcome — a
# green result about the wrong code.
#
# Why the marker is READ and not SOURCED. It holds a bare path and nothing else,
# so a `head -n1` is enough; sourcing a file to obtain one string would be
# arbitrary code execution in every `bakers` invocation on the machine, for no
# gain.

# tier 1 — the test-setup workspace, found by walking up the filesystem.
# `cd -P` resolves symlinks once, so a workspace reached through a symlinked
# path still matches; `|| d=$PWD` keeps the shim working from a deleted
# directory instead of erroring on the first line.
d=$(cd -P . 2>/dev/null && pwd) || d=$PWD
while [ -n "$d" ] && [ "$d" != / ]; do
    if [ -f "$d/.bakers-testbuild" ]; then
        checkout=$(head -n1 "$d/.bakers-testbuild")
        if [ -n "$checkout" ] && [ -x "$checkout/bakers-cli/bin/bakers" ] \
           && [ -f "$checkout/bakers-cli/conductor/dist/src/index.js" ]; then
            exec "$checkout/bakers-cli/bin/bakers" "$@"
        fi
        echo "bakers: test workspace $d names checkout $checkout, which is not built." >&2
        echo "      run: cd $checkout/bakers-cli && pnpm install && pnpm -r run build" >&2
        exit 1
    fi
    d=$(dirname "$d")
done

# tier 2 — the globally-installed bakers in the active node's bin dir (tracks the
# current nvm version instead of a hardcoded path).
node_bin=$(command -v node 2>/dev/null)
if [ -n "$node_bin" ] && [ -x "$(dirname "$node_bin")/bakers" ]; then
    exec "$(dirname "$node_bin")/bakers" "$@"
fi
echo "bakers: no global bakers on PATH, and no .bakers-testbuild workspace above $PWD" >&2
exit 127
