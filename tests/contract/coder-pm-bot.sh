#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Behaviour of the bakers-ddev template's PM bot start script
# (coder/bakers-ddev/scripts/pm-bot.sh), with a docker stub on PATH and local
# git repositories. Nothing real starts.
#
#   bash tests/contract/coder-pm-bot.sh     (Linux: bash 5, GNU coreutils, git)
#
# Asserts:
#   - no bot parameter set: one "no bot configured" line, compose down, no up
#   - a missing required parameter or template variable is named
#   - exactly one model credential; UUIDs, URLs, the image pin, the bakers.build
#     API key and Slack ID lists are checked; lists separated by commas, spaces or both become one
#     comma list
#   - a complete configuration writes the env file (mode 600, every key the
#     container reads, the API key as BAKERS_API_KEY and no OAuth client keys,
#     no repository or registry token), refreshes the
#     secret-free clone, logs in to the registry with the token on stdin only
#     and brings the compose project up with the pinned image
#   - empty allowed users serve everyone; a list serves only those users
#   - without a repository URL the clone directory is emptied; a changed URL
#     replaces the clone; a secret file in the clone stops the bot
#   - a failing clone, login or up takes the bot down and exits 0
#   - a hand-edited env file is rewritten, and a planted link is replaced, not
#     followed
#   - no secret value appears in the output or any recorded argument list
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/coder/bakers-ddev/scripts/pm-bot.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test \
  GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test

# --- Stubs ------------------------------------------------------------------
# docker appends its argument list to $CALLS, its stdin to $CALLS.stdin and the
# compose variables to $CALLS.env. DOCKER_FAIL names a subcommand that fails.
STUB="$SCRATCH/stub"
CALLS="$SCRATCH/calls"
mkdir -p "$STUB"
cat > "$STUB/docker" <<'EOF'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$CALLS"
case "$*" in
  login*) cat >> "$CALLS.stdin"; echo >> "$CALLS.stdin" ;;
  *" up "*) env | grep '^PM_BOT_' | sort > "$CALLS.env" ;;
esac
for word in $DOCKER_FAIL; do
  case " $* " in *" $word "*) echo "docker $word failed" >&2; exit 1 ;; esac
done
exit 0
EOF
chmod +x "$STUB/docker"

# --- Fixtures ---------------------------------------------------------------
# The customer repository the bot may read, with a secret file the clone leaves out.
CUSTOMER="$SCRATCH/customer"
mkdir -p "$CUSTOMER/web/modules/custom/prices"
echo '<?php // code' > "$CUSTOMER/web/modules/custom/prices/prices.module"
echo secret > "$CUSTOMER/.env"
echo secret > "$CUSTOMER/web/settings.local.php"
git -C "$CUSTOMER" init --quiet
git -C "$CUSTOMER" add -A
git -C "$CUSTOMER" commit --quiet -m fixture

DIGEST=sha256:$(printf '%064d' 7)
IMAGE="registry.example.test:5050/bakers/pm-bot:abc123@$DIGEST"

# Secrets: unique values, so a leak is found by a plain grep.
BOT_TOKEN=xoxb-secret-bot-4711
APP_TOKEN=xapp-secret-app-4712
BAKERS_KEY=bb-api-key-secret-4713
API_KEY=sk-ant-secret-4714
REPO_TOKEN=repo-token-secret-4715
REGISTRY_TOKEN=registry-token-secret-4716
SECRETS=("$BOT_TOKEN" "$APP_TOKEN" "$BAKERS_KEY" "$API_KEY" "$REPO_TOKEN" "$REGISTRY_TOKEN")

# A fresh home per case. Sets R; run sets OUT and STATUS.
R=""
fresh() {
  R="$SCRATCH/home.$1"
  mkdir -p "$R"
  : > "$CALLS"; : > "$CALLS.stdin"; rm -f "$CALLS.env"
}
DATA() { echo "$R/.pm-bot/data"; }
CLONE() { echo "$R/.pm-bot/clone"; }

# Every PM_BOT_* variable starts empty; a case sets the ones it needs.
PARAMS=(SLACK_BOT_TOKEN SLACK_APP_TOKEN SLACK_ALLOWED_CHANNELS SLACK_ALLOWED_USERS SLACK_ADMIN_USERS
  SLACK_WORKSPACE_URL SLACK_HOME_CHANNEL BAKERS_URL BAKERS_API_KEY PROJECT
  TICKET_WORKFLOW CONDUCTOR ANTHROPIC_API_KEY CLAUDE_OAUTH_TOKEN MODEL REPO_URL REPO_USER REPO_TOKEN
  IMAGE REGISTRY_USER REGISTRY_TOKEN)

# run VAR=value…: the script with only the given PM_BOT_* values set.
run() {
  local env=(env -i PATH="$STUB:/usr/local/bin:/usr/bin:/bin" HOME="$R" CALLS="$CALLS"
    DOCKER_FAIL="${DOCKER_FAIL:-}" GIT_CONFIG_GLOBAL=/dev/null)
  local p
  for p in "${PARAMS[@]}"; do env+=("PM_BOT_$p="); done
  env+=("$@")
  set +e
  OUT="$("${env[@]}" bash "$SCRIPT" 2>&1)"
  STATUS=$?
  set -e
}

# A complete configuration; a case appends overrides.
FULL=(
  PM_BOT_SLACK_BOT_TOKEN="$BOT_TOKEN" PM_BOT_SLACK_APP_TOKEN="$APP_TOKEN"
  PM_BOT_SLACK_ALLOWED_CHANNELS="C0000000001" PM_BOT_SLACK_ADMIN_USERS="U0000000009"
  PM_BOT_SLACK_WORKSPACE_URL="https://example.slack.com"
  PM_BOT_BAKERS_URL="https://bakers.example.test" PM_BOT_BAKERS_API_KEY="$BAKERS_KEY"
  PM_BOT_PROJECT="00000000-0000-4000-8000-000000000000"
  PM_BOT_TICKET_WORKFLOW=bb_work PM_BOT_MODEL=claude-sonnet-5-5 PM_BOT_ANTHROPIC_API_KEY="$API_KEY"
  PM_BOT_IMAGE="$IMAGE" PM_BOT_REGISTRY_USER=deploy PM_BOT_REGISTRY_TOKEN="$REGISTRY_TOKEN"
)

expect_skip() { # expect_skip <case> <text>
  [ "$STATUS" -eq 0 ] || fail "$1: exit $STATUS, expected 0: $OUT"
  grep -qF "pm-bot: skipped: $2" <<<"$OUT" || fail "$1: no skip line '$2' in: $OUT"
  grep -q '^docker compose -p pm-bot down' "$CALLS" || fail "$1: the bot was not taken down"
  ! grep -q ' up ' "$CALLS" || fail "$1: the bot was brought up"
}

expect_up() { # expect_up <case>
  [ "$STATUS" -eq 0 ] || fail "$1: exit $STATUS: $OUT"
  ! grep -q 'pm-bot: skipped' <<<"$OUT" || fail "$1: skipped: $OUT"
  grep -q "^docker compose -p pm-bot -f .*compose.yaml up -d" "$CALLS" || fail "$1: compose up did not run: $(cat "$CALLS")"
}

no_leak() { # no_leak <case>
  local s
  for s in "${SECRETS[@]}"; do
    ! grep -qF -- "$s" <<<"$OUT" || fail "$1: a secret is in the output"
    ! grep -qF -- "$s" "$CALLS" || fail "$1: a secret is in an argument list"
  done
}

mode() { stat -c %a "$1"; }

# --- 1. No bot configured ---------------------------------------------------
fresh none
run PM_BOT_TICKET_WORKFLOW=bb_work PM_BOT_MODEL=claude-sonnet-5-5 PM_BOT_IMAGE="$IMAGE" PM_BOT_REGISTRY_USER=deploy PM_BOT_REGISTRY_TOKEN="$REGISTRY_TOKEN"
expect_skip none "no bot configured"
[ "$(grep -c 'pm-bot: skipped' <<<"$OUT")" = 1 ] || fail "none: not exactly one skip line: $OUT"
! grep -q '^docker login' "$CALLS" || fail "none: logged in to the registry"
[ ! -e "$(DATA)/.env" ] || fail "none: wrote an env file"
pass "no bot parameter set: no bot configured, down, no up"

# --- 2. Missing parameters ----------------------------------------------------
fresh missing
run PM_BOT_SLACK_BOT_TOKEN="$BOT_TOKEN" PM_BOT_TICKET_WORKFLOW=bb_work PM_BOT_MODEL=claude-sonnet-5-5
expect_skip missing "missing parameters: pm_bot_slack_app_token pm_bot_slack_allowed_channels pm_bot_slack_admin_users pm_bot_slack_workspace_url pm_bot_bakers_url pm_bot_bakers_api_key pm_bot_project pm_bot_image (template variable)"
no_leak missing
fresh noimage
run "${FULL[@]}" PM_BOT_IMAGE=
expect_skip noimage "missing parameters: pm_bot_image (template variable)"
pass "a missing parameter or template variable is named"

# --- 3. Model credential ------------------------------------------------------
fresh nocred
run "${FULL[@]}" PM_BOT_ANTHROPIC_API_KEY=
expect_skip nocred "set exactly one of pm_bot_anthropic_api_key and pm_bot_claude_oauth_token"
fresh twocred
run "${FULL[@]}" PM_BOT_CLAUDE_OAUTH_TOKEN=sk-ant-oat-4717
expect_skip twocred "set exactly one of pm_bot_anthropic_api_key and pm_bot_claude_oauth_token"
pass "exactly one model credential"

# --- 4. Values ----------------------------------------------------------------
check_value() { # check_value <case> <skip text> VAR=value…
  local name="$1" text="$2"; shift 2
  fresh "$name"
  run "${FULL[@]}" "$@"
  expect_skip "$name" "$text"
  no_leak "$name"
}
check_value project "pm_bot_project must be a UUID" PM_BOT_PROJECT=BAKERS
check_value conductor "pm_bot_conductor must be a UUID" PM_BOT_CONDUCTOR=nope
check_value channels "pm_bot_slack_allowed_channels must list Slack IDs" "PM_BOT_SLACK_ALLOWED_CHANNELS=C01;C02"
check_value users "pm_bot_slack_allowed_users must list Slack IDs" "PM_BOT_SLACK_ALLOWED_USERS=@rafi"
check_value admins "pm_bot_slack_admin_users must list Slack IDs" "PM_BOT_SLACK_ADMIN_USERS=,"
check_value home "pm_bot_slack_home_channel must be a Slack ID" "PM_BOT_SLACK_HOME_CHANNEL=C01 C02"
check_value slackurl "pm_bot_slack_workspace_url must be an https:// URL" PM_BOT_SLACK_WORKSPACE_URL=example.slack.com
check_value bakersurl "pm_bot_bakers_url must be an https:// or http:// URL" PM_BOT_BAKERS_URL=bakers.example.test
check_value unsafe "pm_bot_ticket_workflow may hold only" "PM_BOT_TICKET_WORKFLOW=a\"b"
check_value keyspace "pm_bot_bakers_api_key must be one word" "PM_BOT_BAKERS_API_KEY=bb key 4713"
check_value tagonly "pm_bot_image must name its digest" "PM_BOT_IMAGE=registry.example.test/bakers/pm-bot:abc123"
check_value repocred "pm_bot_repo_url carries credentials" "PM_BOT_REPO_URL=https://u@git.example.test/x.git"
check_value repohttp "pm_bot_repo_url must be an https:// URL" "PM_BOT_REPO_URL=git@git.example.test:x.git"
check_value repotoken "pm_bot_repo_token needs pm_bot_repo_url" PM_BOT_REPO_TOKEN="$REPO_TOKEN"
pass "UUIDs, URLs, the image pin, the API key and Slack ID lists are checked"

# --- 5. A complete configuration ---------------------------------------------
# The clone runs against a local repository: the script accepts file:// only
# through PM_BOT_ALLOW_FILE_REPO, which a workspace never sets.
fresh full
run "${FULL[@]}" "PM_BOT_SLACK_ALLOWED_CHANNELS=C01, C02 C03,C04" PM_BOT_ALLOW_FILE_REPO=1 \
  PM_BOT_REPO_URL="file://$CUSTOMER" PM_BOT_REPO_USER=reader PM_BOT_REPO_TOKEN="$REPO_TOKEN"
expect_up full
ENVFILE="$(DATA)/.env"
[ "$(mode "$ENVFILE")" = 600 ] || fail "full: env file mode is $(mode "$ENVFILE"), not 600"
for line in "SLACK_BOT_TOKEN=$BOT_TOKEN" "SLACK_APP_TOKEN=$APP_TOKEN" SLACK_ALLOWED_CHANNELS=C01,C02,C03,C04 \
  SLACK_ALLOWED_USERS= GATEWAY_ALLOW_ALL_USERS=true SLACK_ADMIN_USERS=U0000000009 \
  SLACK_WORKSPACE_URL=https://example.slack.com SLACK_HOME_CHANNEL= BAKERS_URL=https://bakers.example.test \
  "BAKERS_API_KEY=$BAKERS_KEY" \
  PM_BOT_PROJECT=00000000-0000-4000-8000-000000000000 PM_BOT_TICKET_WORKFLOW=bb_work PM_BOT_CONDUCTOR= \
  "ANTHROPIC_API_KEY=$API_KEY" CLAUDE_CODE_OAUTH_TOKEN= PM_BOT_MODEL=claude-sonnet-5-5 \
  HERMES_HOME=/opt/data PM_BOT_CLONE_DIR=/opt/clone; do
  grep -qxF -- "$line" "$ENVFILE" || fail "full: env file lacks $line"
done
! grep -q '^PM_BOT_REPO' "$ENVFILE" || fail "full: the env file names the repository"
! grep -q '^BAKERS_CLIENT_' "$ENVFILE" || fail "full: the env file holds OAuth client keys"
! grep -qF -- "$REPO_TOKEN" "$ENVFILE" || fail "full: the repository token is in the env file"
! grep -qF -- "$REGISTRY_TOKEN" "$ENVFILE" || fail "full: the registry token is in the env file"
[ -f "$(CLONE)/web/modules/custom/prices/prices.module" ] || fail "full: the clone is missing the code"
[ ! -e "$(CLONE)/.env" ] && [ ! -e "$(CLONE)/web/settings.local.php" ] || fail "full: the clone holds a secret file"
! grep -rqF -- "$REPO_TOKEN" "$(CLONE)/.git" || fail "full: the repository token is in the clone's git config"
grep -qx "docker login --username deploy --password-stdin registry.example.test:5050" "$CALLS" \
  || fail "full: no registry login with the token on stdin: $(cat "$CALLS")"
grep -qxF -- "$REGISTRY_TOKEN" "$CALLS.stdin" || fail "full: the registry token did not reach docker login on stdin"
for line in "PM_BOT_IMAGE=$IMAGE" "PM_BOT_DATA=$(DATA)" "PM_BOT_CLONE=$(CLONE)" "PM_BOT_UID=$(id -u)" "PM_BOT_GID=$(id -g)"; do
  grep -qxF -- "$line" "$CALLS.env" || fail "full: compose does not get $line: $(cat "$CALLS.env")"
done
no_leak full
pass "a complete configuration writes the env file, clones, logs in and brings the bot up"

# A second start: the clone is refreshed, a hand edit to the env file is gone.
echo "SLACK_ALLOWED_CHANNELS=CHANDEDIT" >> "$ENVFILE"
: > "$CALLS"
run "${FULL[@]}" PM_BOT_ALLOW_FILE_REPO=1 PM_BOT_REPO_URL="file://$CUSTOMER"
expect_up restart
! grep -q CHANDEDIT "$ENVFILE" || fail "restart: the hand edit survived"
grep -qx SLACK_ALLOWED_CHANNELS=C0000000001 "$ENVFILE" || fail "restart: the parameter did not apply"
pass "a second start rewrites the env file from the parameters"

# A link planted in the data directory is replaced, never written through.
echo untouched > "$R/victim"
rm "$ENVFILE" && ln -s "$R/victim" "$ENVFILE"
run "${FULL[@]}"
expect_up link
[ "$(cat "$R/victim")" = untouched ] || fail "link: the script wrote through a link"
[ -f "$ENVFILE" ] && [ ! -L "$ENVFILE" ] || fail "link: the env file is not a regular file"
pass "a planted link is replaced, not followed"

# A changed repository URL replaces the clone instead of pulling the old one.
OTHER="$SCRATCH/other"
mkdir -p "$OTHER" && echo other > "$OTHER/OTHER.md"
git -C "$OTHER" init --quiet && git -C "$OTHER" add -A && git -C "$OTHER" commit --quiet -m other
run "${FULL[@]}" PM_BOT_ALLOW_FILE_REPO=1 PM_BOT_REPO_URL="file://$OTHER"
expect_up newrepo
[ -f "$(CLONE)/OTHER.md" ] && [ ! -e "$(CLONE)/web" ] || fail "newrepo: the clone was not replaced"
pass "a changed repository URL replaces the clone"

# A secret file in the clone stops the bot.
echo secret > "$(CLONE)/id.pem"
: > "$CALLS"
run "${FULL[@]}" PM_BOT_ALLOW_FILE_REPO=1 PM_BOT_REPO_URL="file://$OTHER"
expect_skip secret "secret files in the clone"
rm "$(CLONE)/id.pem"
pass "a secret file in the clone stops the bot"

# --- 6. No repository: the clone directory is emptied --------------------------
: > "$CALLS"
run "${FULL[@]}"
expect_up norepo
[ -d "$(CLONE)" ] && [ -z "$(ls -A "$(CLONE)")" ] || fail "norepo: the clone directory is not empty"
pass "without a repository the bot runs on an empty clone directory"

# --- 7. Allowed users set: no allow-all ----------------------------------------
fresh users
run "${FULL[@]}" "PM_BOT_SLACK_ALLOWED_USERS=U01 U02"
expect_up users
grep -qx SLACK_ALLOWED_USERS=U01,U02 "$(DATA)/.env" || fail "users: allowed users not normalized"
! grep -q GATEWAY_ALLOW_ALL_USERS "$(DATA)/.env" || fail "users: allow-all set although users are listed"
pass "allowed users set: only they are allowed"

# --- 8. A public registry: no login --------------------------------------------
fresh public
run "${FULL[@]}" PM_BOT_REGISTRY_USER= PM_BOT_REGISTRY_TOKEN=
expect_up public
! grep -q '^docker login' "$CALLS" || fail "public: logged in without a token"
pass "no registry token: no login"

# --- 9. Failures take the bot down ---------------------------------------------
fresh clonefail
run "${FULL[@]}" PM_BOT_ALLOW_FILE_REPO=1 PM_BOT_REPO_URL="file://$SCRATCH/missing" PM_BOT_REPO_TOKEN="$REPO_TOKEN"
expect_skip clonefail "refreshing the clone of file://$SCRATCH/missing failed"
no_leak clonefail
fresh loginfail
DOCKER_FAIL=login run "${FULL[@]}"
expect_skip loginfail "docker login to registry.example.test:5050 failed"
no_leak loginfail
fresh upfail
DOCKER_FAIL=up run "${FULL[@]}"
[ "$STATUS" -eq 0 ] || fail "upfail: exit $STATUS"
grep -qF "pm-bot: skipped: docker compose up failed" <<<"$OUT" || fail "upfail: no skip line: $OUT"
grep -q '^docker compose -p pm-bot down' "$CALLS" || fail "upfail: the bot was not taken down"
no_leak upfail
pass "a failing clone, login or up takes the bot down and exits 0"
