#!/usr/bin/env bash
# Run the PM bot (pm-bot/ of bakers.build: Hermes gateway and poller) in this workspace as one
# Docker Compose service from the pinned bot image (pm-bot.compose.yaml). install.sh runs it as
# coder on every start, after its services.
#
# The configuration comes from the workspace parameters and template variables, which the
# agent passes as PM_BOT_* environment variables (README › PM bot). On every start it checks
# them, rewrites the bot's env file in its data directory, refreshes the secret-free clone of
# the project's repository, logs in to the image registry and brings the service up. A secret
# value never reaches an argument list or a log: it goes from the environment into the env
# file, a git header from the environment, or docker login's stdin.
#
# It never fails the workspace start. Whatever stops the bot takes the service down and writes
# one "pm-bot: skipped: <reason>" line to the startup log.
set -uo pipefail

BOT_DIR="$HOME/.pm-bot"
DATA="$BOT_DIR/data"
CLONE="$BOT_DIR/clone"
COMPOSE=/usr/local/share/pm-bot/compose.yaml
PROJECT=pm-bot
# The characters the container's render accepts in a value: no space, quote, newline or
# shell character.
SAFE='^[A-Za-z0-9./][A-Za-z0-9._~:/,@+=%-]*$'
SAFE_TEXT='letters, digits and . _ ~ : / , @ + = % -, starting with a letter, digit, / or .'
UUID='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

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
)
# In this order in the missing-parameters line.
REQUIRED=(slack_bot_token slack_app_token slack_allowed_channels slack_admin_users
  slack_workspace_url bakers_url bakers_client_id bakers_client_secret project
  ticket_workflow model)

value() { local var="PM_BOT_${1^^}"; printf '%s' "${!var:-}"; }

skip() {
  docker compose -p "$PROJECT" down >/dev/null 2>&1
  echo "pm-bot: skipped: $*"
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
[ -n "$(value image)" ] || missing+=("pm_bot_image (template variable)")
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
  [ -z "$v" ] || [[ "$v" =~ $UUID ]] || skip "pm_bot_$name must be a UUID"
done
[[ "$(value slack_workspace_url)" == https://* ]] || skip "pm_bot_slack_workspace_url must be an https:// URL"
[[ "$(value bakers_url)" =~ ^https?:// ]] || skip "pm_bot_bakers_url must be an https:// or http:// URL"

unsafe=()
for name in "${!ENV_KEYS[@]}" repo_url repo_user repo_token registry_user registry_token; do
  v="$(value "$name")"
  [ -z "$v" ] || [[ "$v" =~ $SAFE ]] || unsafe+=("pm_bot_$name")
done
[ ${#unsafe[@]} -eq 0 ] || skip "${unsafe[*]} may hold only $SAFE_TEXT"

# The image runs exactly as pinned: tag and digest.
image="$(value image)"
[[ "$image" =~ ^[a-z0-9.:/_-]+(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$ ]] \
  || skip "pm_bot_image must name its digest (<registry>/<path>:<tag>@sha256:<digest>)"
registry="${image%%/*}"

# The clone URL stays in the clone's .git/config, which the bot reads: no credentials in it.
# Tokens go into a header from the environment, never into a URL.
repo="$(value repo_url)"
case "$repo" in
  *://*@*) skip "pm_bot_repo_url carries credentials; set the user and token parameters instead" ;;
  '' | https://*) ;;
  file://*) [ -n "${PM_BOT_ALLOW_FILE_REPO:-}" ] || skip "pm_bot_repo_url must be an https:// URL" ;;
  *) skip "pm_bot_repo_url must be an https:// URL" ;;
esac
[ -n "$repo" ] || [ -z "$(value repo_user)$(value repo_token)" ] \
  || skip "pm_bot_repo_token needs pm_bot_repo_url"

# --- The env file ----------------------------------------------------------------------
# Rewritten on every start, so a changed parameter applies and a hand edit is gone. The bot
# can write the data directory: the file is replaced by a rename, never written through a
# link it may have planted.
mkdir -p "$DATA" "$CLONE" && chmod 700 "$BOT_DIR" || skip "preparing $BOT_DIR failed"
envfile="$(umask 077 && mktemp -p "$DATA" .env.XXXXXX)" || skip "writing $DATA/.env failed"
{
  for name in "${!ENV_KEYS[@]}"; do
    printf '%s=%s\n' "${ENV_KEYS[$name]}" "$(value "$name")"
  done
  printf '%s=%s\n' HERMES_HOME /opt/data PM_BOT_CLONE_DIR /opt/clone
  [ -n "$(value slack_allowed_users)" ] || echo GATEWAY_ALLOW_ALL_USERS=true
} >"$envfile" && mv -f "$envfile" "$DATA/.env" || { rm -f "$envfile"; skip "writing $DATA/.env failed"; }

# --- The clone -------------------------------------------------------------------------
# A sparse checkout without env files, Drupal settings, package-manager credentials and
# keys, mounted read-only into the container; no secret is readable through the
# clone-reader. Each pattern is excluded from the checkout and checked for afterwards.
SECRETS=('.env*' 'settings*.php' 'services.local.yml' 'auth.json' '.npmrc' '*.pem' '*.key')
if [ -n "$repo" ]; then
  # An existing clone is pulled; one of another repository is replaced.
  if [ -d "$CLONE/.git" ] && [ "$(git -C "$CLONE" config --get remote.origin.url)" != "$repo" ]; then
    rm -rf "$CLONE" && mkdir "$CLONE" || skip "replacing the clone in $CLONE failed"
  fi
  (
    token_header "$(value repo_user)" "$(value repo_token)"
    # Without coder's own git config: an insteadOf rule there would send the URL over SSH,
    # where the token does not apply.
    export GIT_TERMINAL_PROMPT=0 GIT_CONFIG_GLOBAL=/dev/null
    { [ -d "$CLONE/.git" ] || git clone --quiet --filter=blob:none --no-checkout "$repo" "$CLONE"; } \
      && git -C "$CLONE" sparse-checkout set --no-cone '/*' "${SECRETS[@]/#/!**/}" \
      && git -C "$CLONE" checkout --quiet \
      && git -C "$CLONE" pull --quiet --ff-only
  ) || skip "refreshing the clone of $repo failed (see above)"
  names=()
  for pattern in "${SECRETS[@]}"; do names+=(-o -name "$pattern"); done
  secrets="$(find "$CLONE" -path "$CLONE/.git" -prune -o \( "${names[@]:1}" \) -print)"
  [ -z "$secrets" ] || skip "secret files in the clone, remove them: $(echo $secrets)"
else
  rm -rf "$CLONE" && mkdir "$CLONE" || skip "emptying $CLONE failed"
fi

# --- Start -----------------------------------------------------------------------------
if [ -n "$(value registry_token)" ]; then
  printf '%s\n' "$(value registry_token)" \
    | docker login --username "$(value registry_user)" --password-stdin "$registry" >/dev/null \
    || skip "docker login to $registry failed"
fi
PM_BOT_UID="$(id -u)"
PM_BOT_GID="$(id -g)"
export PM_BOT_DATA="$DATA" PM_BOT_CLONE="$CLONE" PM_BOT_UID PM_BOT_GID PM_BOT_IMAGE="$image"
docker compose -p "$PROJECT" -f "$COMPOSE" up -d --pull missing --remove-orphans \
  || skip "docker compose up failed (see above)"
echo "pm-bot: running $image"
exit 0
