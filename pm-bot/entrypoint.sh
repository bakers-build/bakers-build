#!/usr/bin/env bash
# The PM bot container's start, as the hermes user after Hermes' own bootstrap
# (pm-bot/Dockerfile). On every start it:
#   1. checks the required env (from the data directory's .env) and names what is missing;
#   2. renders config.yaml and the skill's project reference from the env (render.mjs);
#   3. puts SOUL.md and the project-manager skill into the data directory, replacing them;
#      sessions, memories, other skills and the poller state stay;
#   4. runs the poller and the Hermes gateway. When either exits, the container exits and
#      its restart policy starts it again.
#
#   entrypoint.sh [run]   start the bot (the image's default)
#   entrypoint.sh check   steps 1-3, then print the versions, test the connection to
#                         bakers.build's MCP endpoint and exit (CI's image check)
set -euo pipefail

BOT=/opt/pm-bot
DATA="${HERMES_HOME:-/opt/data}"
mode="${1:-run}"

REQUIRED=(SLACK_BOT_TOKEN SLACK_APP_TOKEN SLACK_ALLOWED_CHANNELS SLACK_ADMIN_USERS
  SLACK_WORKSPACE_URL BAKERS_URL BAKERS_API_KEY PM_BOT_PROJECT
  PM_BOT_TICKET_WORKFLOW PM_BOT_MODEL PM_BOT_CLONE_DIR)
missing=()
for key in "${REQUIRED[@]}"; do
  [ -n "${!key:-}" ] || missing+=("$key")
done
[ ${#missing[@]} -eq 0 ] || { echo "pm-bot: missing: ${missing[*]}" >&2; exit 1; }

# Every user in the allowed channels, unless an allowlist names some.
[ -n "${SLACK_ALLOWED_USERS:-}" ] || export GATEWAY_ALLOW_ALL_USERS=true
# The conductor is optional; the render refuses empty values, so the skill reads "none".
export PM_BOT_CONDUCTOR_TEXT="${PM_BOT_CONDUCTOR:-none}"

node "$BOT/render.mjs" "$BOT/config.template.yaml" "$DATA/config.yaml"
install -m 644 "$BOT/SOUL.md" "$DATA/SOUL.md"
skill="$DATA/skills/project-manager"
mkdir -p "$DATA/skills"
rm -rf "$skill.new"
cp -R "$BOT/skills/project-manager" "$skill.new"
node "$BOT/render.mjs" "$skill.new/references/project.template.md" "$skill.new/references/project.md"
rm "$skill.new/references/project.template.md"
rm -rf "$skill"
mv "$skill.new" "$skill"

if [ "$mode" = check ]; then
  version="$(hermes --version)"
  echo "${version%%$'\n'*}"
  echo "node $(node --version)"
  # bakers.build's MCP endpoint exactly as the rendered config reaches it, with the key
  # Hermes fills from the env file: connected ...
  hermes mcp test bakers
  # ... and the tools Hermes registers from it, through its own include filter.
  (cd /opt/hermes && .venv/bin/python - <<'PY'
from hermes_cli.mcp_config import _get_mcp_servers, _probe_single_server
from tools.mcp_tool_registration import _make_tool_filter

config = _get_mcp_servers()["bakers"]
keep = _make_tool_filter("bakers", config)
names = sorted(name for name, _ in _probe_single_server("bakers", config) if keep(name))
print("bakers tools: " + ",".join(names))
PY
  )
  exit 0
fi
[ "$mode" = run ] || { echo "usage: entrypoint.sh [run|check]" >&2; exit 2; }

pids=()
stop() { kill -TERM "${pids[@]}" 2>/dev/null || true; }
trap stop TERM INT
node "$BOT/poller/poller.mjs" &
pids+=($!)
hermes gateway run &
pids+=($!)
status=0
wait -n "${pids[@]}" || status=$?
echo "pm-bot: a process exited ($status); stopping the container" >&2
stop
wait || true
exit "$status"
