#!/usr/bin/env bash
# =============================================================================
# BB-390 — repository-level contract for the `bakers` PATH shim's RESOLUTION.
#
# `tests/contract/` does NOT run in CI (a green pipeline does not cover this
# suite), so this file is a BY-HAND gate: run it for this ticket and for any
# later change to `bakers-cli/templates/bakers.pathshim.sh` or to the marker
# `.bakers/scripts/setup-test-project.sh` writes.
#
#   bash tests/contract/pathshim-resolution.sh
#
# WHAT IS ASSERTED. The shim selects a checkout's own build in exactly ONE
# place — inside a test-setup workspace, recognised by a `.bakers-testbuild`
# marker at or above the physical working directory — and the globally
# installed CLI everywhere else, a plain bakers checkout included. Before
# BB-390 the first tier fired on `git rev-parse --show-toplevel` holding an
# executable `bakers-cli/bin/bakers`, so an unbuilt branch build broke `bakers` for
# every unrelated command issued anywhere inside that checkout.
#
# HOW. The SHIPPED template is executed, byte for byte — there is no second
# copy of the resolution logic to drift — against a fixture tree in a
# `mktemp -d`: a fake checkout whose launcher echoes one marker, and a fake
# global `bakers` on a stubbed PATH that echoes another. Which marker comes back
# is the whole verdict. No bakers build, no DDEV, no network and no installed
# CLI are involved, and `~/.local/bin/bakers` is neither read nor written.
#
# The fixture's fake checkout and fake workspace are BOTH real git repos, so
# the git-based tier this ticket removes would still fire if it came back:
# that is what makes the "plain bakers checkout gets the global CLI" and the
# "per-ticket worktree gets the checkout build" assertions meaningful rather
# than vacuous.
# =============================================================================
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

SHIM="${ROOT}/bakers-cli/templates/bakers.pathshim.sh"
[ -f "${SHIM}" ] || fail "bakers-cli/templates/bakers.pathshim.sh is missing"

CHECKOUT_MARK='FIXTURE-CHECKOUT-BUILD'
GLOBAL_MARK='FIXTURE-GLOBAL-CLI'

# --- the fixture tree --------------------------------------------------------
TMP="$(mktemp -d)"
trap 'chmod -R u+w "${TMP}" 2>/dev/null || true; rm -rf "${TMP}"' EXIT

CHECKOUT="${TMP}/checkout"
WORKSPACE="${CHECKOUT}/workspaces/bakers-playground"
TICKET_WT="${WORKSPACE}/.bakers-worktrees/feat/x"
OUTSIDE="${TMP}/outside"
LINK="${TMP}/link-to-workspace"
STUB_BIN="${TMP}/bin"
DIST="${CHECKOUT}/bakers-cli/conductor/dist/src/index.js"

mkdir -p "${CHECKOUT}/bakers-cli/bin" "$(dirname "${DIST}")" \
  "${TICKET_WT}" "${OUTSIDE}" "${STUB_BIN}"

# The fake checkout's launcher and its compiled entry point. The launcher is
# what the shim execs; the dist file is what it probes for before doing so.
cat >"${CHECKOUT}/bakers-cli/bin/bakers" <<EOF
#!/usr/bin/env sh
echo '${CHECKOUT_MARK}'
EOF
chmod +x "${CHECKOUT}/bakers-cli/bin/bakers"
: >"${DIST}"

# The fake GLOBAL cli. The shim finds it as `\$(dirname \$(command -v node))/bakers`,
# so the stub directory has to carry a `node` too — a symlink to the real one,
# because the shim only ever asks where it is.
cat >"${STUB_BIN}/bakers" <<EOF
#!/usr/bin/env sh
echo '${GLOBAL_MARK}'
EOF
chmod +x "${STUB_BIN}/bakers"
ln -sfn "$(command -v node)" "${STUB_BIN}/node"

# Both are real git repos: see the header. The workspace being its own repo is
# also the real arrangement — it is a clone of the fixture project.
git -C "${CHECKOUT}" init --quiet
git -C "${WORKSPACE}" init --quiet
printf '%s\n' "${CHECKOUT}" >"${WORKSPACE}/.bakers-testbuild"
ln -sfn "${WORKSPACE}" "${LINK}"

# Run the SHIPPED shim from a directory and print what it resolved to. stderr is
# folded into stdout so a diagnostic is part of the verdict, and the exit status
# is appended as a last line, so one helper serves both the success and the
# failure assertions.
resolve() {
  local dir="$1" out status
  set +e
  out="$( cd "${dir}" && PATH="${STUB_BIN}:${PATH}" sh "${SHIM}" --version 2>&1 )"
  status=$?
  set -e
  printf '%s\nEXIT:%d\n' "${out}" "${status}"
}
verdict() {
  local got
  got="$(resolve "$1")"
  case "${got}" in
    *"${CHECKOUT_MARK}"*) printf 'checkout\n' ;;
    *"${GLOBAL_MARK}"*) printf 'global\n' ;;
    *) printf 'neither\n' ;;
  esac
}

# === 1. Inside the test-setup workspace: THIS checkout's build ===============
#
# The one place the branch build is under test, and therefore the one place a
# bare `bakers` must be it.
[ "$(verdict "${WORKSPACE}")" = 'checkout' ] \
  || fail "inside the workspace the shim did not select the checkout build: $(resolve "${WORKSPACE}")"
pass "inside a .bakers-testbuild workspace the shim execs the named checkout's build"

# === 2. Inside a per-ticket worktree of that workspace: same =================
#
# The conductor's checkoutRoot is the DIRECTORY OF ITS CONFIG (`<workspace>/.bakers`),
# so its worktrees land INSIDE the workspace. This is why the walk is over the
# filesystem: a git-based lookup stops at this worktree's own toplevel and never
# sees the marker two levels up.
[ "$(verdict "${TICKET_WT}")" = 'checkout' ] \
  || fail "inside a per-ticket worktree of the workspace the shim did not select the checkout build: $(resolve "${TICKET_WT}")"
pass "the marker is found from a per-ticket worktree nested inside the workspace"

# === 3. Inside a plain bakers checkout: the GLOBAL cli =========================
#
# The behaviour change this ticket exists for. The fixture checkout carries an
# executable `bakers-cli/bin/bakers` and a built dist and is a git repo, so the old
# tier would have selected it; with no marker at or above it, the shim must not.
[ "$(verdict "${CHECKOUT}")" = 'global' ] \
  || fail "inside a plain bakers checkout the shim did not select the global CLI: $(resolve "${CHECKOUT}")"
pass "a plain bakers checkout gets the globally installed CLI, not its own build"

# === 4. Outside every checkout: the GLOBAL cli ==============================
[ "$(verdict "${OUTSIDE}")" = 'global' ] \
  || fail "outside every checkout the shim did not select the global CLI: $(resolve "${OUTSIDE}")"
pass "outside every checkout the shim execs the globally installed CLI"

# === 5. Reached through a symlink: still THIS checkout's build ===============
#
# `cd -P` resolves the symlink once, so the walk starts from the physical path.
# Asserted because the alternative — walking the logical $PWD — silently misses
# the marker for anyone whose workspace is reached through a link.
[ "$(verdict "${LINK}")" = 'checkout' ] \
  || fail "reached through a symlink the workspace did not resolve to the checkout build: $(resolve "${LINK}")"
pass "a workspace reached through a symlink still resolves to its checkout's build"

# === 6. A marker naming an UNBUILT checkout fails LOUDLY ====================
#
# Not a fall-through: falling back to the global CLI here hands the run a
# different `bakers` than the one under test, silently, in the single place whose
# purpose is to test that build. So all three halves are asserted — non-zero
# exit, the checkout named in the message, and the global marker ABSENT.
mv "${DIST}" "${DIST}.away"
unbuilt="$(resolve "${WORKSPACE}")"
mv "${DIST}.away" "${DIST}"

grep -q 'EXIT:1' <<<"${unbuilt}" \
  || fail "an unbuilt checkout named by a marker did not exit 1: ${unbuilt}"
grep -qF "${CHECKOUT}" <<<"${unbuilt}" \
  || fail "the failure does not name the checkout that is not built: ${unbuilt}"
if grep -qF "${GLOBAL_MARK}" <<<"${unbuilt}"; then
  fail "an unbuilt checkout FELL THROUGH to the global CLI: ${unbuilt}"
fi
if grep -qF "${CHECKOUT_MARK}" <<<"${unbuilt}"; then
  fail "the shim ran an unbuilt checkout's launcher anyway: ${unbuilt}"
fi
pass "a marker naming an unbuilt checkout exits 1, names it, and does not fall through"

# === 7. The git-based tier is GONE from the source ==========================
#
# The behavioural assertions above can all be satisfied while the old fork is
# still there and merely shadowed, and the fork is itself part of the cost this
# ticket removes: `git rev-parse` ran on every `bakers` invocation on the machine.
#
# COMMENT LINES ARE SKIPPED, on purpose: the shim's header EXPLAINS which tier
# was removed and therefore names `git rev-parse`. A checker that cannot tell
# prose from a command would be satisfied by deleting the explanation, which is
# the opposite of what this asserts. What is asserted is stricter than "no
# rev-parse" in exchange — no executable line invokes git at all.
git_in_code="$(grep -vE '^[[:space:]]*#' "${SHIM}" | grep -nE '(^|[^[:alnum:]_])git[[:space:]]' || true)"
[ -z "${git_in_code}" ] || {
  echo "${git_in_code}" >&2
  fail "the shim still shells out to git — the git-toplevel tier must be gone"
}
pass "no executable line of the shim invokes git"

echo "OK: BB-390 pathshim resolution contract"
