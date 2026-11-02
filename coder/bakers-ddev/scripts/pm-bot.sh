#!/usr/bin/env bash
# Start the PM bot (pm-bot/ of bakers.build: Hermes gateway and poller) in this workspace, as
# the unprivileged user pmbot. install.sh runs it as coder on every start, after its services.
#
# The configuration comes from the workspace parameters and template variables, which the
# agent passes as PM_BOT_* environment variables (README › PM bot). A secret value never
# reaches an argument list or a log: it goes from the environment into the bot's env file only.
#
# It never fails the workspace start. Whatever stops the bot writes one line saying why to
# the startup log and to /tmp/hermes-gateway.log, and leaves everything else running.
#
# PM_BOT_ROOT prefixes every system path; tests/contract/coder-pm-bot.sh runs the script
# against a scratch root. Unset in a workspace.
set -uo pipefail

ROOT="${PM_BOT_ROOT:-}"
GATEWAY_LOG=$ROOT/tmp/hermes-gateway.log
POLLER_LOG=$ROOT/tmp/pm-bot-poller.log
BOT=$ROOT/opt/pm-bot
BOT_USER=pmbot
BOT_UID=1500
BOT_HOME=$ROOT/home/pmbot
BOT_HERMES_HOME=$BOT_HOME/.hermes-pmbot
CLONE_DIR=$BOT_HOME/clone
DOCKER_SOCKET=$ROOT/var/run/docker.sock
BOT_PATH=$BOT_HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# The characters bin/setup accepts in a value: no space, quote, newline or shell character.
SAFE='^[A-Za-z0-9./][A-Za-z0-9._~:/,@+=%-]*$'
SAFE_TEXT='letters, digits and . _ ~ : / , @ + = % -, starting with a letter, digit, / or .'

# Workspace parameter pm_bot_<name> (environment PM_BOT_<NAME>) → key in the bot's env file.
declare -A ENV_KEYS=(
  [slack_bot_token]=SLACK_BOT_TOKEN
  [slack_app_token]=SLACK_APP_TOKEN
  [slack_allowed_channels]=SLACK_ALLOWED_CHANNELS
  [slack_allowed_users]=SLACK_ALLOWED_USERS
  [slack_admin_users]=SLACK_ADMIN_USERS
  [slack_workspace_url]=SLACK_WORKSPACE_URL
  [slack_home_channel]=SLACK_HOME_CHANNEL
  [bakers_url]=BAKERS_URL
  [bakers_client_id]=BAKERS_CLIENT_ID
  [bakers_client_secret]=BAKERS_CLIENT_SECRET
  [project]=PM_BOT_PROJECT
  [ticket_workflow]=PM_BOT_TICKET_WORKFLOW
  [conductor]=PM_BOT_CONDUCTOR
  [anthropic_api_key]=ANTHROPIC_API_KEY
  [claude_oauth_token]=CLAUDE_CODE_OAUTH_TOKEN
  [model]=PM_BOT_MODEL
  [repo_url]=PM_BOT_REPO_URL
)
# In this order in the missing-parameters line.
REQUIRED=(slack_bot_token slack_app_token slack_allowed_channels slack_admin_users
  slack_workspace_url bakers_url bakers_client_id bakers_client_secret project
  ticket_workflow model)

value() { local var="PM_BOT_${1^^}"; printf '%s' "${!var:-}"; }

skip() {
  echo "pm-bot: skipped: $*"
  # Root writes only to a regular file, never through a link pmbot may have planted in /tmp.
  if [ -L "$GATEWAY_LOG" ] || [ ! -f "$GATEWAY_LOG" ]; then
    sudo rm -f "$GATEWAY_LOG" && sudo install -m 600 /dev/null "$GATEWAY_LOG"
  fi
  printf 'pm-bot: skipped: %s\n' "$*" | sudo tee -a "$GATEWAY_LOG" >/dev/null
  exit 0
}

# token_header USER TOKEN: git sends the token as HTTP Basic auth, configured through the
# environment only. Nothing without a token.
token_header() {
  [ -n "$2" ] || return 0
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader
  GIT_CONFIG_VALUE_0="Authorization: Basic $(printf '%s:%s' "${1:-oauth2}" "$2" | base64 -w0)"
  export GIT_CONFIG_VALUE_0
}

apt_install() { { sudo apt-get update -qq && sudo apt-get install -y -qq "$@"; } >/dev/null; }

as_bot() { sudo -u "$BOT_USER" -H env HOME="$BOT_HOME" PATH="$BOT_PATH" HERMES_HOME="$BOT_HERMES_HOME" "$@"; }

cd / || exit 0

# --- Configuration ---------------------------------------------------------------------
# Parameters with a default (model, ticket workflow) and the template variables do not count.
configured=false
for name in slack_bot_token slack_app_token slack_allowed_channels slack_allowed_users \
  slack_admin_users slack_workspace_url slack_home_channel bakers_url bakers_client_id \
  bakers_client_secret project conductor anthropic_api_key claude_oauth_token repo_url \
  repo_user repo_token; do
  [ -z "$(value "$name")" ] || configured=true
done
[ "$configured" = true ] || skip "no bot configured"

missing=()
for name in "${REQUIRED[@]}"; do
  [ -n "$(value "$name")" ] || missing+=("pm_bot_$name")
done
for name in source_url ref; do
  [ -n "$(value "$name")" ] || missing+=("pm_bot_$name (template variable)")
done
[ ${#missing[@]} -eq 0 ] || skip "missing parameters: ${missing[*]}"

credentials=0
for name in anthropic_api_key claude_oauth_token; do
  [ -z "$(value "$name")" ] || credentials=$((credentials + 1))
done
[ "$credentials" -eq 1 ] || skip "set exactly one of pm_bot_anthropic_api_key and pm_bot_claude_oauth_token"

# Slack ID lists: commas, whitespace or both separate the IDs (README › PM bot); the env file
# gets one comma list. normalize NAME sets PM_BOT_<NAME> to that list.
normalize() {
  local var="PM_BOT_${1^^}" list
  list="$(printf '%s' "${!var:-}" | tr -s ', \t\r\n' ',')"
  list="${list#,}"
  printf -v "$var" '%s' "${list%,}"
}
for name in slack_allowed_channels slack_allowed_users slack_admin_users; do
  normalize "$name"
  v="$(value "$name")"
  { [ -z "$v" ] && [ "$name" = slack_allowed_users ]; } || [[ "$v" =~ ^[A-Z0-9]+(,[A-Z0-9]+)*$ ]] \
    || skip "pm_bot_$name must list Slack IDs (letters and digits), separated by commas or spaces"
done
v="$(value slack_home_channel)"
[ -z "$v" ] || [[ "$v" =~ ^[A-Z0-9]+$ ]] || skip "pm_bot_slack_home_channel must be a Slack ID"
for name in project conductor; do
  v="$(value "$name")"
  [ -z "$v" ] || [[ "$v" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
    || skip "pm_bot_$name must be a UUID"
done
[[ "$(value slack_workspace_url)" == https://* ]] || skip "pm_bot_slack_workspace_url must be an https:// URL"
[[ "$(value bakers_url)" =~ ^https?:// ]] || skip "pm_bot_bakers_url must be an https:// or http:// URL"

unsafe=()
for name in "${!ENV_KEYS[@]}" source_url ref source_user source_token repo_user repo_token; do
  v="$(value "$name")"
  [ -z "$v" ] || [[ "$v" =~ $SAFE ]] || unsafe+=("pm_bot_$name")
done
[ ${#unsafe[@]} -eq 0 ] || skip "${unsafe[*]} may hold only $SAFE_TEXT"

[[ "$(value ref)" =~ ^[0-9a-f]{40}$ ]] || skip "pm_bot_ref must be a full commit hash"
# Both URLs show up in skip lines; the clone's also stays in its .git/config, which pmbot reads.
# Tokens go into a header from the environment, never into a URL.
for name in source_url repo_url; do
  case "$(value "$name")" in
    *://*@*) skip "pm_bot_$name carries credentials; set the user and token parameters instead" ;;
  esac
done
[ -n "$(value repo_url)" ] || [ -z "$(value repo_user)$(value repo_token)" ] \
  || skip "pm_bot_repo_token needs pm_bot_repo_url"

for tool in node npx; do
  PATH="$BOT_PATH" command -v "$tool" >/dev/null || skip "$tool is not on PATH outside /home/coder (README › PM bot)"
done

# --- The bot's code at the pinned revision ---------------------------------------------
mkdir -p "$HOME/.local/tmp"
work="$(mktemp -d -p "$HOME/.local/tmp")"
trap 'rm -rf "$work"' EXIT
(
  # The deploy token reaches git through the environment only: no URL, argument or file.
  token_header "$(value source_user)" "$(value source_token)"
  export GIT_TERMINAL_PROMPT=0
  # Without coder's own git config: an insteadOf rule there would send the HTTPS source URL
  # over SSH, where the deploy token does not apply.
  export GIT_CONFIG_GLOBAL=/dev/null
  git init -q "$work/src" \
    && git -C "$work/src" remote add origin "$(value source_url)" \
    && git -C "$work/src" sparse-checkout set pm-bot \
    && git -C "$work/src" fetch -q --depth 1 --filter=blob:none origin "$(value ref)" \
    && git -C "$work/src" checkout -q FETCH_HEAD
) && [ -x "$work/src/pm-bot/bin/start" ] \
  || skip "fetching pm-bot/ at $(value ref) from $(value source_url) failed (see /tmp/coder-startup-script.log)"
sudo rm -rf "$BOT.new" \
  && sudo cp -R "$work/src/pm-bot" "$BOT.new" \
  && sudo chown -R root:root "$BOT.new" \
  && sudo chmod -R u+w,go-w,a+rX "$BOT.new" \
  && sudo rm -rf "$BOT" \
  && sudo mv "$BOT.new" "$BOT" \
  || skip "installing the bot's code to $BOT failed"
echo "pm-bot: code at $(value ref) installed to $BOT"

# --- The bot user ----------------------------------------------------------------------
# Nothing the bot needs lives in coder's home; locked, it keeps the bot from coder's
# credentials, checkouts and worktrees.
sudo chmod 700 "$HOME" || skip "locking $HOME failed"
# The container is recreated on every start; the user's home is a volume that stays.
id "$BOT_USER" >/dev/null 2>&1 \
  || sudo useradd --uid "$BOT_UID" --user-group --home-dir "$BOT_HOME" --no-create-home --shell /usr/sbin/nologin "$BOT_USER" \
  || skip "creating the user $BOT_USER failed"
sudo chown "$BOT_USER:$BOT_USER" "$BOT_HOME" && sudo chmod 700 "$BOT_HOME" || skip "preparing $BOT_HOME failed"
# The Docker socket would make pmbot root in the workspace. An ACL entry keeps pmbot out and
# leaves every other user's access as it was; checked as pmbot either way.
if [ -S "$DOCKER_SOCKET" ]; then
  command -v setfacl >/dev/null || apt_install acl || skip "installing acl to keep $BOT_USER from $DOCKER_SOCKET failed"
  sudo setfacl -m "u:$BOT_USER:---" "$DOCKER_SOCKET" || skip "keeping $BOT_USER from $DOCKER_SOCKET failed"
fi
! as_bot test -w "$DOCKER_SOCKET" || skip "$BOT_USER can still reach $DOCKER_SOCKET"

# --- The env file ----------------------------------------------------------------------
envfile="$(umask 077 && mktemp -p "$work")"
{
  for name in "${!ENV_KEYS[@]}"; do
    printf '%s=%s\n' "${ENV_KEYS[$name]}" "$(value "$name")"
  done
  printf '%s=%s\n' HERMES_HOME "$BOT_HERMES_HOME" PM_BOT_CLONE_DIR "$CLONE_DIR" \
    PM_BOT_GATEWAY_LOG "$GATEWAY_LOG" PM_BOT_POLLER_LOG "$POLLER_LOG"
  # bin/start sets it too; written here, the env file says what runs.
  [ -n "$(value slack_allowed_users)" ] || echo GATEWAY_ALLOW_ALL_USERS=true
} >"$envfile"
sudo install -o "$BOT_USER" -g "$BOT_USER" -m 600 "$envfile" "$BOT/.env" || skip "writing $BOT/.env failed"

# --- The clone -------------------------------------------------------------------------
# As pmbot, in pmbot's home: git in a folder the bot can write must never run as coder or
# root, where a planted .git/config would run code. The repository token reaches git through
# the environment only, which sudo passes on by name.
if [ -n "$(value repo_url)" ]; then
  # bin/clone pulls an existing clone; one of another repository is replaced.
  if as_bot test -d "$CLONE_DIR/.git" \
    && [ "$(as_bot git -C "$CLONE_DIR" config --get remote.origin.url)" != "$(value repo_url)" ]; then
    as_bot rm -rf "$CLONE_DIR" || skip "replacing the clone in $CLONE_DIR failed"
  fi
  (
    token_header "$(value repo_user)" "$(value repo_token)"
    PM_BOT_REPO_URL="$(value repo_url)"
    export PM_BOT_REPO_URL PM_BOT_CLONE_DIR="$CLONE_DIR" GIT_TERMINAL_PROMPT=0 GIT_CONFIG_GLOBAL=/dev/null
    sudo -u "$BOT_USER" -H \
      --preserve-env=PM_BOT_REPO_URL,PM_BOT_CLONE_DIR,GIT_TERMINAL_PROMPT,GIT_CONFIG_GLOBAL,GIT_CONFIG_COUNT,GIT_CONFIG_KEY_0,GIT_CONFIG_VALUE_0 \
      env HOME="$BOT_HOME" PATH="$BOT_PATH" "$BOT/bin/clone"
  ) || skip "refreshing the clone of $(value repo_url) failed (see /tmp/coder-startup-script.log)"
else
  as_bot rm -rf "$CLONE_DIR" && as_bot mkdir -m 700 "$CLONE_DIR" || skip "emptying $CLONE_DIR failed"
fi

# --- Hermes ----------------------------------------------------------------------------
version="$(sed -n 's/^HERMES_VERSION=//p' "$BOT/bin/setup")"
commit="$(sed -n 's/^HERMES_COMMIT=//p' "$BOT/bin/setup")"
pinned() {
  local line
  line="$(as_bot hermes --version 2>/dev/null | head -1)"
  [[ "$line" == *" v$version "*" local $commit"* ]]
}
# Each Hermes data folder needs its own prepared runtime; when that alone does not give the
# pinned version, the official installer runs as the bot.
repair() { as_bot hermes pm repair >/dev/null 2>&1 || true; }
pinned || repair
if ! pinned; then
  # Hermes' own Node needs libatomic1, a system library the bot cannot install.
  ldconfig -p 2>/dev/null | grep -q 'libatomic\.so\.1' || apt_install libatomic1 \
    || skip "installing libatomic1 for Hermes failed"
  installer="https://raw.githubusercontent.com/NousResearch/hermes-agent/v$version/scripts/install.sh"
  echo "pm-bot: installing Hermes v$version ($commit) as $BOT_USER"
  as_bot bash -c 'set -e; t="$(mktemp)"; trap "rm -f \"\$t\"" EXIT; curl -fsSL "$1" -o "$t"
    bash "$t" --commit "$2" --skip-setup --skip-browser --skip-computer-use </dev/null' _ "$installer" "$commit" \
    || skip "installing Hermes v$version ($commit) failed (see /tmp/coder-startup-script.log)"
  repair
  pinned || skip "Hermes is not v$version ($commit) after installing (see /tmp/coder-startup-script.log)"
fi

# --- Start -----------------------------------------------------------------------------
as_bot "$BOT/bin/setup" || skip "bin/setup failed (see /tmp/coder-startup-script.log)"
for log in "$GATEWAY_LOG" "$POLLER_LOG"; do
  # pmbot's own regular file is kept. Anything else, a skip line of root or a link, is
  # replaced, so root never follows a link pmbot planted.
  if [ -L "$log" ] || { [ -e "$log" ] && [ "$(stat -c %U "$log")" != "$BOT_USER" ]; }; then
    sudo rm -f "$log"
  fi
  [ -e "$log" ] || sudo install -o "$BOT_USER" -g "$BOT_USER" -m 600 /dev/null "$log"
  as_bot chmod 600 "$log" || skip "preparing $log failed"
done
# Own session (setsid), like herdr server: the bot outlives this script.
as_bot setsid "$BOT/bin/start" || skip "bin/start failed (see /tmp/coder-startup-script.log)"
exit 0
