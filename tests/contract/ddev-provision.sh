#!/usr/bin/env bash
set -euo pipefail

# `.ddev/commands/host/provision` reuses a ready site, starts a stopped one and installs a missing
# or different one. A fake `ddev` on PATH logs its calls; a local HTTP server stands in for the site.

root="$(git rev-parse --show-toplevel)"
script="$root/.ddev/commands/host/provision"
work="$(mktemp -d)"
server_pid=
cleanup() { [ -z "$server_pid" ] || kill "$server_pid" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

mkdir -p "$work/bin"
cat > "$work/bin/ddev" <<'EOF'
#!/bin/bash
echo "$*" >> "$STATE/calls"
case "$1" in
  describe)
    [ -f "$STATE/status" ] || { echo 'no project' >&2; exit 1; }
    printf '{"raw":{"status":"%s","primary_url":"%s","approot":"%s"}}\n' "$(cat "$STATE/status")" "$URL" "$APPROOT" ;;
  # DDEV runs the resolved project's copy of the command in its approot.
  provision) shift; cd "$APPROOT" && DDEV_APPROOT="$APPROOT" bash .ddev/commands/host/provision "$@" ;;
  config) echo 'rewritten' > .ddev/config.yaml ;;
  start) echo running > "$STATE/status" ;;
  init)
    if [ -f "$STATE/init-fails" ]; then echo 'init broke'; exit 2; fi
    echo running > "$STATE/status" ;;
esac
EOF
chmod +x "$work/bin/ddev"

echo 200 > "$work/http-code"
CODE_FILE="$work/http-code" node -e '
const fs = require("node:fs");
const server = require("node:http").createServer((_, res) => {
  res.statusCode = Number(fs.readFileSync(process.env.CODE_FILE, "utf8")); res.end();
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
' > "$work/port" &
server_pid=$!
for _ in $(seq 50); do [ -s "$work/port" ] && break; sleep 0.1; done
export URL="http://127.0.0.1:$(cat "$work/port")"

failures=0
fail() { echo "FAIL $case: $*"; failures=$((failures + 1)); }

# arrange <status|-> <marker|-> <http code>; then run <provider>; sets $out and $rc.
arrange() {
  export STATE="$work/state"
  rm -rf "$STATE" "$work/app"; mkdir -p "$STATE" "$work/app/.ddev/.bakers-test"; : > "$STATE/calls"
  [ "$1" = - ] || echo "$1" > "$STATE/status"
  [ "$2" = - ] || echo "$2" > "$work/app/.ddev/.bakers-test/profile"
  echo "$3" > "$work/http-code"
  export APPROOT="$work/app"
}
run() {
  rc=0
  out="$(cd "$work/app" && DDEV_APPROOT="$work/app" PATH="$work/bin:$PATH" bash "$script" --provider "$1" 2>&1)" || rc=$?
}
calls() { grep -cE "^$1" "$STATE/calls" || true; }
marker() { cat "$work/app/.ddev/.bakers-test/profile" 2>/dev/null || true; }

case=ready; arrange running recipe-test 200; run recipe-test
[ "$rc" = 0 ] || fail "exit $rc: $out"
[ "$(calls 'start|init')" = 0 ] || fail "ran setup: $(cat "$STATE/calls")"
grep -qF "ready $URL" <<<"$out" || fail "no ready URL: $out"

case=stopped; arrange stopped recipe-test 200; run recipe-test
[ "$rc" = 0 ] || fail "exit $rc: $out"
[ "$(calls start)" = 1 ] && [ "$(calls init)" = 0 ] || fail "calls: $(cat "$STATE/calls")"
grep -qF "started $URL" <<<"$out" || fail "no started URL: $out"

case=missing; arrange - - 200; run recipe-test
[ "$rc" = 0 ] || fail "exit $rc: $out"
grep -qx 'init --provider recipe-test' "$STATE/calls" || fail "no init: $(cat "$STATE/calls")"
[ "$(marker)" = recipe-test ] || fail "marker: $(marker)"
grep -qF "installed $URL" <<<"$out" || fail "no installed URL: $out"

case=other-profile; arrange running existing-config 200; run recipe-test
[ "$rc" = 0 ] || fail "exit $rc: $out"
grep -qx 'init --provider recipe-test' "$STATE/calls" || fail "no init: $(cat "$STATE/calls")"
[ "$(marker)" = recipe-test ] || fail "marker: $(marker)"

case=init-fails; arrange running existing-config 200; touch "$STATE/init-fails"; run recipe-test
[ "$rc" != 0 ] || fail 'exit 0'
grep -q 'init broke' <<<"$out" || fail "output lost: $out"
[ -z "$(marker)" ] || fail "marker left: $(marker)"

case=url-500; arrange - - 500; run recipe-test
[ "$rc" != 0 ] || fail "exit 0: $out"

case=no-provider; arrange - - 200; rc=0
out="$(cd "$work/app" && PATH="$work/bin:$PATH" bash "$script" 2>&1)" || rc=$?
[ "$rc" != 0 ] || fail 'exit 0'

# hook <name> <profile|->: a hook command from .bakers/project.config.js, run in a git worktree
# nested in the ready site $work/app, where deps are stubbed; sets $out and $rc.
hook() {
  local tree="$work/app/wt"
  rm -rf "$tree"; mkdir -p "$tree/.bakers/scripts" "$tree/.ddev/commands/host"
  git -C "$tree" init -q; cp "$script" "$tree/.ddev/commands/host/"
  cp "$root/.bakers/provision.sh" "$tree/.bakers/"
  printf '#!/bin/bash\n' > "$tree/.bakers/scripts/worktree-deps.sh"
  cp "$root/.bakers/scripts/ddev-own-project.sh" "$tree/.bakers/scripts/" 2>/dev/null || true
  local cmd
  cmd="$(cd "$root" && node --input-type=module -e '
const { hooks } = (await import("./.bakers/project.config.js")).default;
console.log(process.argv[2] === "-" ? hooks[process.argv[1]] : hooks[process.argv[1]][process.argv[2]]);
' "$1" "$2")"
  rc=0
  out="$(cd "$tree" && PATH="$work/bin:$PATH" bash -c "$cmd" 2>&1)" || rc=$?
}

# An unregistered worktree makes DDEV resolve the registered parent; its ready site is not ours.
for profile in recipe-test existing-config existing-config-fresh conductor-e2e; do
  case="parent-project $profile"; arrange running "$profile" 200
  mkdir -p "$work/app/.ddev/commands/host"; cp "$script" "$work/app/.ddev/commands/host/"
  hook provision_up "$profile"
  [ "$rc" != 0 ] || fail "exit 0: $out"
  grep -qF "$work/app" <<<"$out" || fail "parent approot not named: $out"
  [ "$(calls 'provision|init|start')" = 0 ] || fail "ran setup: $(cat "$STATE/calls")"
done
case=own-project; arrange running - 200; export APPROOT="$work/app/wt"; hook provision_up recipe-test
[ "$rc" = 0 ] && grep -qx 'provision --provider recipe-test' "$STATE/calls" || fail "exit $rc, calls: $(cat "$STATE/calls"): $out"
case=parent-project-delete; arrange running - 200; hook after_done -
[ "$(calls delete)" = 0 ] || fail "deleted the parent: $(cat "$STATE/calls")"

# A new worktree registers its own project on creation and keeps the tracked config.yaml.
case=register; tree="$work/register"
mkdir -p "$tree/.bakers/scripts" "$tree/.ddev" "$tree/.bakers"
cp "$root/.bakers/scripts/setup-worktree.mjs" "$tree/.bakers/scripts/"; cp "$root/.bakers/scripts/worktree-post.sh" "$tree/.bakers/scripts/"
printf 'name: bakers\n# kept\n' > "$tree/.ddev/config.yaml"; touch "$tree/.bakers/.worktree-post-done"
git -C "$tree" init -q; STATE="$work/state"; : > "$STATE/calls"; rc=0
out="$(cd "$tree" && PATH="$work/bin:$PATH" bash .bakers/scripts/worktree-post.sh 2>&1)" || rc=$?
[ "$rc" = 0 ] || fail "exit $rc: $out"
[ "$(cat "$STATE/calls")" = 'config --auto' ] || fail "calls: $(cat "$STATE/calls")"
[ "$(cat "$tree/.ddev/config.yaml")" = "$(printf 'name: bakers\n# kept')" ] || fail 'config.yaml rewritten'

# The fixed entry point dispatches only the declared profiles, preserving order and failure status.
case=provision-dispatch
provision_tree="$work/dispatch"
mkdir -p "$provision_tree/.bakers/scripts" "$provision_tree/bin"
cp "$root/.bakers/provision.sh" "$provision_tree/.bakers/"
for name in worktree-deps ddev-own-project docs-preview conductor-e2e; do
  cat > "$provision_tree/.bakers/scripts/$name.sh" <<'EOF'
#!/bin/bash
printf '%s%s\n' "$(basename "$0")" "${*:+ $*}" >> "$TRACE"
[ "${FAIL_COMMAND:-}" != "$(basename "$0")" ] || exit 29
EOF
done
cat > "$provision_tree/bin/ddev" <<'EOF'
#!/bin/bash
echo "ddev $*" >> "$TRACE"
[ "${FAIL_COMMAND:-}" != ddev ] || exit 29
EOF
chmod +x "$provision_tree/bin/ddev"
export TRACE="$provision_tree/trace"
dispatch() {
  : > "$TRACE"; rc=0
  out="$(cd "$provision_tree" && PATH="$provision_tree/bin:$PATH" bash .bakers/provision.sh "$@" 2>&1)" || rc=$?
}
while IFS='|' read -r profile expected; do
  case="provision-dispatch $profile"
  command="$(cd "$root" && node --input-type=module -e 'console.log((await import("./.bakers/project.config.js")).default.hooks.provision_up[process.argv[1]])' "$profile")"
  [ "$command" = "bash .bakers/provision.sh $profile" ] || fail "unstable entry point: $command"
  dispatch "$profile"
  [ "$rc" = 0 ] || fail "exit $rc: $out"
  [ "$(paste -sd ';' "$TRACE")" = "$expected" ] || fail "calls: $(cat "$TRACE")"
done <<'EOF'
deps|worktree-deps.sh --all
docs-preview|worktree-deps.sh --all;docs-preview.sh
conductor-e2e|worktree-deps.sh --all;ddev-own-project.sh;ddev provision --provider recipe-test;conductor-e2e.sh
conductor-e2e-stop|conductor-e2e.sh stop
conductor-e2e-start|conductor-e2e.sh start
recipe-test|worktree-deps.sh;ddev-own-project.sh;ddev provision --provider recipe-test
existing-config|worktree-deps.sh;ddev-own-project.sh;ddev provision --provider existing-config
existing-config-fresh|worktree-deps.sh;ddev-own-project.sh;ddev init --provider existing-config
EOF
case=provision-invalid-profile
for profile in '' unknown 'recipe-test; touch bad'; do
  dispatch "$profile"
  [ "$rc" != 0 ] && [ ! -s "$TRACE" ] || fail "invalid profile ran actions: $profile: $out"
done
dispatch
[ "$rc" != 0 ] && [ ! -s "$TRACE" ] || fail 'missing profile ran actions'
dispatch deps extra
[ "$rc" != 0 ] && [ ! -s "$TRACE" ] || fail 'extra arguments ran actions'
for failed in worktree-deps.sh ddev-own-project.sh ddev; do
  case="provision-failure $failed"
  export FAIL_COMMAND="$failed"
  dispatch conductor-e2e
  unset FAIL_COMMAND
  [ "$rc" = 29 ] || fail "failure status lost: $rc: $out"
  case "$failed" in
    worktree-deps.sh) expected='worktree-deps.sh --all' ;;
    ddev) expected='ddev provision --provider recipe-test' ;;
    *) expected="$failed" ;;
  esac
  [ "$(tail -n1 "$TRACE")" = "$expected" ] || fail "continued after failure: $(cat "$TRACE")"
done

# Agents run Playwright through ddev_exec, so the web image's browsers must match the suite's lock.
case=playwright-image
locked="$(node -p 'require(process.argv[1]).packages["node_modules/@playwright/test"].version' "$root/tests/playwright/package-lock.json")"
image="$root/.ddev/web-build/Dockerfile.playwright"
grep -qF "playwright@$locked " "$image" 2>/dev/null || fail "$image does not install playwright@$locked"
grep -qE '@playwright/cli@[0-9]+\.[0-9]+\.[0-9]+ ' "$image" 2>/dev/null || fail "$image does not pin @playwright/cli"
grep -qF "cd tests/playwright && npm ci" "$root/.ddev/commands/host/init" || fail 'init does not install the Playwright suite'

# Install output and seeded fixture files must remain writable with .ddev mounted read-only.
case=container-artifacts
artifact_root="$work/artifacts-project"
mkdir -p "$artifact_root/.ddev" "$work/install-bin"
printf '#!/bin/bash\necho install-output\n' > "$work/install-bin/drush"
printf '#!/bin/bash\nexit 0\n' > "$work/install-bin/sudo"
printf '#!/bin/bash\necho seed-output\nexit 23\n' > "$work/seed.sh"
chmod +x "$work/install-bin/"*
sed "s@/var/www/html@$artifact_root@g" "$root/.ddev/providers/recipe-install.sh" > "$work/recipe-install.sh"
rc=0
out="$(PATH="$work/install-bin:$PATH" bash "$work/recipe-install.sh" recipe-test "$work/seed.sh" 2>&1)" || rc=$?
[ "$rc" = 23 ] || fail "seed failure lost: exit $rc: $out"
grep -q seed-output <<<"$out" || fail "seed output lost: $out"
[ -f "$artifact_root/tests/artifacts/bakers/init-recipe-test.log" ] || fail 'install log is outside writable artifacts directory'
[ ! -d "$artifact_root/.ddev/.bakers-test" ] || fail 'container install wrote into .ddev'
grep -qxF '/tests/artifacts/bakers/' "$root/.gitignore" || fail 'runtime artifacts are not gitignored'
grep -qxF 'tests/artifacts/bakers/' "$root/.dockerignore" || fail 'runtime artifacts enter Docker build contexts'
for entry in .ddev/commands/web/bakers-init-test .ddev/commands/web/bakers-test-integration .ddev/providers/existing-config.yaml bakers-cli/vitest.config.integration.ts scripts/ci/github-image-gate.sh; do
  grep -qF 'tests/artifacts/bakers' "$root/$entry" || fail "$entry does not use writable runtime artifacts"
done

# That test code is untrusted: the web container gets no SSH agent and no registry token.
case=container-credentials
config="$root/.ddev/config.yaml"
grep -qE '^omit_containers: \[.*ddev-ssh-agent.*\]' "$config" || fail 'ddev-ssh-agent is not omitted'
for token in KEYTEC_REGISTRY_TOKEN KEYTEC_REGISTRY_WRITE_TOKEN; do
  grep -qE "^  - $token=\$" "$config" || fail "$token is not blanked in web_environment"
done

[ "$failures" = 0 ] || exit 1
echo 'PASS ddev provision: ready, stopped, missing, other profile, init failure, URL 500, no provider, parent project, registration, provision dispatch, Playwright image, writable artifacts, container credentials'
