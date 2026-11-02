#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Behaviour of the bakers-ddev template's PM bot start script
# (coder/bakers-ddev/scripts/pm-bot.sh), run against a scratch root
# (PM_BOT_ROOT) with stubs for sudo, useradd, setfacl, id, chown, install and
# hermes on PATH. The bot's code comes from a local git fixture holding this
# checkout's pm-bot/, with bin/start replaced by a recorder; the real
# pm-bot/bin/setup and pm-bot/bin/clone run. Nothing real starts.
#
#   bash tests/contract/coder-pm-bot.sh     (Linux: GNU coreutils, git, perl)
#
# Asserts:
#   - no bot parameter set: one "no bot configured" line, exit 0, no fetch
#   - a missing required parameter, or an empty pm_bot_ref, is named
#   - exactly one model credential; UUIDs, URLs and Slack ID lists are checked
#   - lists separated by commas, spaces or both become one comma list
#   - a complete configuration writes every env key the real bin/setup needs,
#     creates pmbot, clones the repository as pmbot, and starts the bot
#   - without a repository URL the clone directory is emptied
#   - a failing fetch skips the bot and still exits 0
#   - no secret value appears in the output or any recorded argument list,
#     and the repository token is not in the bot's env file
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
# Every stub appends its argument list to $CALLS, so a test can look for a
# leaked secret in any of them.
STUB="$SCRATCH/stub"
CALLS="$SCRATCH/calls"
mkdir -p "$STUB"
export CALLS

stub() { printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s $*" >> "$CALLS"\n%s\n' "$1" "$2" > "$STUB/$1"; chmod +x "$STUB/$1"; }
# sudo runs its command as the caller; options are dropped, the environment kept.
stub sudo 'while [ $# -gt 0 ]; do case "$1" in -u) shift 2 ;; --) shift; break ;; -*) shift ;; *) break ;; esac; done; exec "$@"'
stub useradd 'touch "$CALLS.pmbot"'
stub setfacl ':'
stub chown ':'
stub id '[ "${1:-}" = pmbot ] && { [ -f "$CALLS.pmbot" ]; exit; }; exec /usr/bin/id "$@"'
stub install 'args=(); while [ $# -gt 0 ]; do case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac; done; exec /usr/bin/install "${args[@]}"'
stub git 'exec /usr/bin/git "$@"'

# --- Fixtures ---------------------------------------------------------------
# The bot's code: this checkout's pm-bot/, bin/start replaced by a recorder.
SRC="$SCRATCH/src"
mkdir -p "$SRC"
cp -R "$REPO_ROOT/pm-bot" "$SRC/pm-bot"
rm -f "$SRC/pm-bot/.env"
cat > "$SRC/pm-bot/bin/start" <<'EOF'
#!/usr/bin/env bash
echo "started as $(id -un) HOME=$HOME" >> "$PM_BOT_STARTED"
EOF
chmod +x "$SRC/pm-bot/bin/start"
git -C "$SRC" init --quiet
git -C "$SRC" add -A
git -C "$SRC" commit --quiet -m fixture
REF="$(git -C "$SRC" rev-parse HEAD)"

# The customer repository the bot may read, with a secret file bin/clone leaves out.
CUSTOMER="$SCRATCH/customer"
mkdir -p "$CUSTOMER/web/modules/custom/prices"
echo '<?php // code' > "$CUSTOMER/web/modules/custom/prices/prices.module"
echo secret > "$CUSTOMER/.env"
git -C "$CUSTOMER" init --quiet
git -C "$CUSTOMER" add -A
git -C "$CUSTOMER" commit --quiet -m fixture

PINNED_LINE='Hermes Agent v0.22.5 (2026.9.24) · stable · local bf0203a794a0'

# Secrets: unique values, so a leak is found by a plain grep.
BOT_TOKEN=xoxb-secret-bot-4711
APP_TOKEN=xapp-secret-app-4712
CLIENT_SECRET=client-secret-4713
API_KEY=sk-ant-secret-4714
REPO_TOKEN=repo-token-secret-4715
SOURCE_TOKEN=source-token-secret-4716
SECRETS=("$BOT_TOKEN" "$APP_TOKEN" "$CLIENT_SECRET" "$API_KEY" "$REPO_TOKEN" "$SOURCE_TOKEN")

# A fresh scratch root per case. Sets R, OUT and STATUS after run.
R=""
fresh() {
  R="$SCRATCH/root.$1"
  mkdir -p "$R/home/coder" "$R/home/pmbot/.local/bin" "$R/tmp" "$R/opt"
  printf '#!/bin/sh\necho "%s"\n' "$PINNED_LINE" > "$R/home/pmbot/.local/bin/hermes"
  chmod +x "$R/home/pmbot/.local/bin/hermes"
  : > "$CALLS"
  rm -f "$CALLS.pmbot"
}

# Every PM_BOT_* variable starts empty; a case sets the ones it needs.
PARAMS=(SLACK_BOT_TOKEN SLACK_APP_TOKEN SLACK_ALLOWED_CHANNELS SLACK_ALLOWED_USERS SLACK_ADMIN_USERS
  SLACK_WORKSPACE_URL SLACK_HOME_CHANNEL BAKERS_URL BAKERS_CLIENT_ID BAKERS_CLIENT_SECRET PROJECT
  TICKET_WORKFLOW CONDUCTOR ANTHROPIC_API_KEY CLAUDE_OAUTH_TOKEN MODEL REPO_URL REPO_USER REPO_TOKEN
  SOURCE_URL REF SOURCE_USER SOURCE_TOKEN)

# run VAR=value…: the script with only the given PM_BOT_* values set.
run() {
  local env=(env -i PATH="$STUB:/usr/local/bin:/usr/bin:/bin" HOME="$R/home/coder" CALLS="$CALLS"
    PM_BOT_ROOT="$R" PM_BOT_STARTED="$R/started")
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
  PM_BOT_BAKERS_URL="https://bakers.example.test" PM_BOT_BAKERS_CLIENT_ID="bakers-key-test"
  PM_BOT_BAKERS_CLIENT_SECRET="$CLIENT_SECRET" PM_BOT_PROJECT="00000000-0000-4000-8000-000000000000"
  PM_BOT_TICKET_WORKFLOW=bb_work PM_BOT_MODEL=claude-sonnet-5-5 PM_BOT_ANTHROPIC_API_KEY="$API_KEY"
  PM_BOT_SOURCE_URL="file://$SRC" PM_BOT_REF="$REF"
  PM_BOT_SOURCE_USER=deploy PM_BOT_SOURCE_TOKEN="$SOURCE_TOKEN"
)

expect_skip() { # expect_skip <case> <text>
  [ "$STATUS" -eq 0 ] || fail "$1: exit $STATUS, expected 0: $OUT"
  grep -qF "pm-bot: skipped: $2" <<<"$OUT" || fail "$1: no skip line '$2' in: $OUT"
  grep -qF "pm-bot: skipped: $2" "$R/tmp/hermes-gateway.log" || fail "$1: skip line not in the gateway log"
  [ ! -e "$R/started" ] || fail "$1: the bot started"
}

no_leak() { # no_leak <case>
  local s
  for s in "${SECRETS[@]}"; do
    ! grep -qF -- "$s" <<<"$OUT" || fail "$1: a secret is in the output"
    ! grep -qF -- "$s" "$CALLS" || fail "$1: a secret is in an argument list"
  done
}

# --- 1. No bot configured ---------------------------------------------------
fresh none
run PM_BOT_TICKET_WORKFLOW=bb_work PM_BOT_MODEL=claude-sonnet-5-5 PM_BOT_SOURCE_URL="file://$SRC" PM_BOT_REF="$REF"
expect_skip none "no bot configured"
! grep -q '^git ' "$CALLS" || fail "none: fetched the bot's code"
pass "no bot parameter set: no bot configured, exit 0, no fetch"

# --- 2. Missing parameters ----------------------------------------------------
fresh missing
run PM_BOT_SLACK_BOT_TOKEN="$BOT_TOKEN" PM_BOT_TICKET_WORKFLOW=bb_work PM_BOT_MODEL=claude-sonnet-5-5
expect_skip missing "missing parameters: pm_bot_slack_app_token pm_bot_slack_allowed_channels pm_bot_slack_admin_users pm_bot_slack_workspace_url pm_bot_bakers_url pm_bot_bakers_client_id pm_bot_bakers_client_secret pm_bot_project pm_bot_source_url (template variable) pm_bot_ref (template variable)"
no_leak missing
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
check_value unsafe "pm_bot_bakers_client_id may hold only" "PM_BOT_BAKERS_CLIENT_ID=a\"b"
check_value ref "pm_bot_ref must be a full commit hash" PM_BOT_REF=develop
check_value sourcecred "pm_bot_source_url carries credentials" "PM_BOT_SOURCE_URL=https://u:p@git.example.test/x.git"
check_value repocred "pm_bot_repo_url carries credentials" "PM_BOT_REPO_URL=https://u@git.example.test/x.git"
check_value repotoken "pm_bot_repo_token needs pm_bot_repo_url" PM_BOT_REPO_TOKEN="$REPO_TOKEN"
pass "UUIDs, URLs, Slack ID lists and the pin are checked"

# --- 5. A complete configuration ---------------------------------------------
fresh full
run "${FULL[@]}" "PM_BOT_SLACK_ALLOWED_CHANNELS=C01, C02 C03,C04" \
  PM_BOT_REPO_URL="file://$CUSTOMER" PM_BOT_REPO_USER=reader PM_BOT_REPO_TOKEN="$REPO_TOKEN"
[ "$STATUS" -eq 0 ] || fail "full: exit $STATUS: $OUT"
! grep -q 'pm-bot: skipped' <<<"$OUT" || fail "full: skipped: $OUT"
grep -qx "started as $(id -un) HOME=$R/home/pmbot" "$R/started" || fail "full: bin/start did not run with pmbot's home: $(cat "$R/started" 2>/dev/null)"
grep -q "^useradd .*--uid 1500 .*--shell /usr/sbin/nologin pmbot" "$CALLS" || fail "full: pmbot not created with uid 1500 and nologin"
grep -q "^sudo chmod 700 $R/home/coder\$" "$CALLS" || fail "full: /home/coder not locked"
ENVFILE="$R/opt/pm-bot/.env"
[ "$(stat -c %a "$ENVFILE")" = 600 ] || fail "full: env file mode is not 600"
for line in "SLACK_BOT_TOKEN=$BOT_TOKEN" "SLACK_APP_TOKEN=$APP_TOKEN" SLACK_ALLOWED_CHANNELS=C01,C02,C03,C04 \
  SLACK_ALLOWED_USERS= GATEWAY_ALLOW_ALL_USERS=true SLACK_ADMIN_USERS=U0000000009 \
  SLACK_WORKSPACE_URL=https://example.slack.com SLACK_HOME_CHANNEL= BAKERS_URL=https://bakers.example.test \
  BAKERS_CLIENT_ID=bakers-key-test "BAKERS_CLIENT_SECRET=$CLIENT_SECRET" \
  PM_BOT_PROJECT=00000000-0000-4000-8000-000000000000 PM_BOT_TICKET_WORKFLOW=bb_work PM_BOT_CONDUCTOR= \
  "ANTHROPIC_API_KEY=$API_KEY" CLAUDE_CODE_OAUTH_TOKEN= PM_BOT_MODEL=claude-sonnet-5-5 \
  "PM_BOT_REPO_URL=file://$CUSTOMER" "HERMES_HOME=$R/home/pmbot/.hermes-pmbot" \
  "PM_BOT_CLONE_DIR=$R/home/pmbot/clone" "PM_BOT_GATEWAY_LOG=$R/tmp/hermes-gateway.log" \
  "PM_BOT_POLLER_LOG=$R/tmp/pm-bot-poller.log"; do
  grep -qxF -- "$line" "$ENVFILE" || fail "full: env file lacks $line"
done
! grep -qF -- "$REPO_TOKEN" "$ENVFILE" || fail "full: the repository token is in the env file"
! grep -qF -- "$SOURCE_TOKEN" "$ENVFILE" || fail "full: the deploy token is in the env file"
# The real bin/setup rendered the configuration from that env file.
[ -f "$R/home/pmbot/.hermes-pmbot/config.yaml" ] || fail "full: bin/setup did not render config.yaml"
grep -qF "$R/home/pmbot/clone" "$R/home/pmbot/.hermes-pmbot/config.yaml" || fail "full: clone-reader not on the clone"
[ -f "$R/home/pmbot/clone/web/modules/custom/prices/prices.module" ] || fail "full: the clone is missing the code"
[ ! -e "$R/home/pmbot/clone/.env" ] || fail "full: the clone holds a secret file"
grep -qF "pm-bot: code at $REF" <<<"$OUT" || fail "full: no 'code at <ref>' line"
no_leak full
pass "a complete configuration writes the env file, clones as pmbot and starts the bot"

# A second start (a restart): the clone is refreshed, nothing is lost.
rm -f "$R/started"
run "${FULL[@]}" PM_BOT_REPO_URL="file://$CUSTOMER"
[ "$STATUS" -eq 0 ] && [ -e "$R/started" ] || fail "restart: the bot did not start: $OUT"
pass "a second start runs the bot again"

# A changed repository URL replaces the clone instead of pulling the old one.
OTHER="$SCRATCH/other"
mkdir -p "$OTHER" && echo other > "$OTHER/OTHER.md"
git -C "$OTHER" init --quiet && git -C "$OTHER" add -A && git -C "$OTHER" commit --quiet -m other
rm -f "$R/started"
run "${FULL[@]}" PM_BOT_REPO_URL="file://$OTHER"
[ "$STATUS" -eq 0 ] && [ -e "$R/started" ] || fail "newrepo: the bot did not start: $OUT"
[ -f "$R/home/pmbot/clone/OTHER.md" ] && [ ! -e "$R/home/pmbot/clone/web" ] || fail "newrepo: the clone was not replaced"
pass "a changed repository URL replaces the clone"

# --- 6. No repository: the clone directory is emptied --------------------------
rm -f "$R/started"
run "${FULL[@]}"
[ "$STATUS" -eq 0 ] && [ -e "$R/started" ] || fail "norepo: the bot did not start: $OUT"
[ -d "$R/home/pmbot/clone" ] && [ -z "$(ls -A "$R/home/pmbot/clone")" ] || fail "norepo: the clone directory is not empty"
pass "without a repository the bot runs on an empty clone directory"

# --- 7. Allowed users set: no allow-all ----------------------------------------
fresh users
run "${FULL[@]}" "PM_BOT_SLACK_ALLOWED_USERS=U01 U02"
[ "$STATUS" -eq 0 ] && [ -e "$R/started" ] || fail "users: the bot did not start: $OUT"
grep -qx SLACK_ALLOWED_USERS=U01,U02 "$R/opt/pm-bot/.env" || fail "users: allowed users not normalized"
! grep -q GATEWAY_ALLOW_ALL_USERS "$R/opt/pm-bot/.env" || fail "users: allow-all set although users are listed"
pass "allowed users set: only they are allowed"

# --- 8. Failing fetch ----------------------------------------------------------
fresh fetch
run "${FULL[@]}" PM_BOT_REF=0000000000000000000000000000000000000000
expect_skip fetch "fetching pm-bot/ at 0000000000000000000000000000000000000000"
no_leak fetch
pass "a failing fetch skips the bot and exits 0"
