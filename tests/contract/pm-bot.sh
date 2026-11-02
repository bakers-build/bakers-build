#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Lock-down and configurability contract for the Hermes PM bot (pm-bot/).
#
#   bash tests/contract/pm-bot.sh
#
# Reads the committed configuration template statically (nothing is started)
# and asserts:
#   - every toolset that can change the system is disabled, and Slack enables
#     only the bot's own toolsets
#   - memory writes and self-written skills wait for approval
#   - one shared session per thread, not per user
#   - there is no direct bakers.build MCP server and no OAuth client: pm-relay,
#     signed in with an API key, is the bot's only way into bakers.build
#   - the clone reader is a pinned filesystem server with read tools only
#   - pm-relay is the image's relay, reading the bot's env file, with exactly
#     its four tools, and the relay lists those four
#   - no bb_question tool is named anywhere in the bot
#   - every user in the allowed channels is served unless an allowlist is set
#   - poller, relay and client call no LLM
#   - the Slack app neither reads nor opens direct messages
#   - persona, skill and scripts name no customer; only .env.example may
#   - the relay passes answers on without a "Correct?" confirmation round
#   - customer wording says what happens, not what a team does
#   - the env file is ignored and no committed file holds a token
#   - the bot has no install script (pm-bot/bin/, lib/running.sh)
#   - the template's compose service runs the image with exactly two mounts
#     (data read-write, clone read-only), no Docker socket, restart
#     unless-stopped, every capability dropped but the ones Hermes' bootstrap
#     needs, and no-new-privileges
# Needs python3 with PyYAML.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

BOT=pm-bot
TEMPLATE="$BOT/config.template.yaml"
for f in "$TEMPLATE" "$BOT/SOUL.md" "$BOT/skills/project-manager/SKILL.md" "$BOT/.env.example" \
         "$BOT/README.md" "$BOT/Dockerfile" "$BOT/entrypoint.sh" "$BOT/render.mjs" "$BOT/poller/poller.mjs" "$BOT/poller/diff.mjs" \
         "$BOT/poller/questions.mjs" "$BOT/poller/tickets.mjs" "$BOT/relay/server.mjs" "$BOT/lib/bakers-client.mjs" \
         "$BOT/slack-app-manifest.yaml"; do
  [ -f "$f" ] || fail "$f is missing"
done
pass "pm-bot files present"

python3 - "$TEMPLATE" <<'PY' || fail "configuration template breaks the lock-down (see above)"
import sys, yaml

with open(sys.argv[1]) as fh:
    cfg = yaml.safe_load(fh)

errors = []
def need(cond, msg):
    if not cond:
        errors.append(msg)

disabled = set(cfg.get("agent", {}).get("disabled_toolsets") or [])
for ts in ["terminal", "code_execution", "browser", "web", "delegation", "file", "cronjob"]:
    need(ts in disabled, f"agent.disabled_toolsets lacks {ts}")

allowed = {"skills", "memory", "session_search", "mcp-clone-reader", "mcp-pm-relay"}
slack_ts = set((cfg.get("platform_toolsets") or {}).get("slack") or [])
need(slack_ts, "platform_toolsets.slack is empty or missing")
need("mcp-pm-relay" in slack_ts, "platform_toolsets.slack lacks mcp-pm-relay")
need(slack_ts <= allowed, f"platform_toolsets.slack enables {sorted(slack_ts - allowed)}")
need(not (slack_ts & disabled), "a Slack toolset is also disabled")

need(cfg.get("memory", {}).get("write_approval") is True, "memory.write_approval is not true")
need(cfg.get("skills", {}).get("write_approval") is True, "skills.write_approval is not true")
need(cfg.get("group_sessions_per_user") is False, "group_sessions_per_user is not false")
slack = cfg.get("slack") or {}
for key in ("allow_admin_from", "group_allow_admin_from"):
    need(slack.get(key) == "${SLACK_ADMIN_USERS}", f"slack.{key} does not limit slash commands to SLACK_ADMIN_USERS")

servers = cfg.get("mcp_servers") or {}
need(set(servers) == {"clone-reader", "pm-relay"}, f"mcp_servers are {sorted(servers)}, not clone-reader and pm-relay")
for name, server in servers.items():
    need("auth" not in server and "oauth" not in server, f"{name} signs in with OAuth")
    need("url" not in server, f"{name} is a remote server; bakers.build is reached through pm-relay only")

reader = servers.get("clone-reader") or {}
args = [str(a) for a in reader.get("args") or []]
pkg = [a for a in args if a.startswith("@modelcontextprotocol/server-filesystem@")]
need(pkg and pkg[0].rsplit("@", 1)[1][:1].isdigit(), "clone-reader is not a pinned @modelcontextprotocol/server-filesystem")
need(any("${PM_BOT_CLONE_DIR}" in a for a in args), "clone-reader is not scoped to ${PM_BOT_CLONE_DIR}")
read_only = {"read_text_file", "list_directory", "directory_tree", "search_files", "get_file_info"}
rtools = set((reader.get("tools") or {}).get("include") or [])
need(rtools and rtools <= read_only, f"clone-reader includes {sorted(rtools - read_only)}")

# The bot's only way into bakers.build: the relay baked into the image, reading the env file.
relay = servers.get("pm-relay") or {}
need(relay.get("command") == "node", "pm-relay is not started with node")
need([str(a) for a in relay.get("args") or []] == ["/opt/pm-bot/relay/server.mjs", "${HERMES_HOME}/.env"],
     "pm-relay is not the image's /opt/pm-bot/relay/server.mjs with ${HERMES_HOME}/.env")
need(sorted((relay.get("tools") or {}).get("include") or []) == ["answer_question", "create_ticket", "ticket_read", "ticket_search"],
     "pm-relay does not include exactly create_ticket, answer_question, ticket_read and ticket_search")

# Hermes adds resource and prompt utility calls to every MCP server unless they are switched off.
for name, server in (("clone-reader", reader), ("pm-relay", relay)):
    tfilter = server.get("tools") or {}
    for family in ("resources", "prompts"):
        need(tfilter.get(family) is False, f"{name} tools.{family} is not false")

for e in errors:
    print("FAIL:", e, file=sys.stderr)
sys.exit(1 if errors else 0)
PY
pass "configuration template keeps the lock-down"

# The relay itself lists exactly the four tools the configuration includes.
tools="$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node --input-type=module -e '
  import { createRelay } from "./pm-bot/relay/server.mjs";
  import { createInterface } from "node:readline";
  const relay = createRelay({ client: null, env: {} });
  for await (const line of createInterface({ input: process.stdin })) {
    const { result } = await relay.handle(JSON.parse(line));
    console.log(result.tools.map((t) => t.name).sort().join(","));
  }')"
[ "$tools" = "answer_question,create_ticket,ticket_read,ticket_search" ] || fail "pm-relay lists $tools"
pass "pm-relay lists exactly create_ticket, answer_question, ticket_read and ticket_search"

python3 - "$BOT/slack-app-manifest.yaml" <<'PY' || fail "Slack app manifest lets the bot read or open direct messages (see above)"
import sys, yaml

with open(sys.argv[1]) as fh:
    manifest = yaml.safe_load(fh)

errors = []
scopes = set(((manifest.get("oauth_config") or {}).get("scopes") or {}).get("bot") or [])
events = set(((manifest.get("settings") or {}).get("event_subscriptions") or {}).get("bot_events") or [])
home = (manifest.get("features") or {}).get("app_home") or {}
for scope in sorted(scopes & {"im:write", "im:history", "im:read", "mpim:history", "mpim:read", "mpim:write"}): errors.append(f"bot scopes include {scope}")
for event in sorted(events & {"message.im", "message.mpim"}): errors.append(f"bot events include {event}")
if home.get("messages_tab_enabled") is not False: errors.append("app_home.messages_tab_enabled is not false")
if not (manifest.get("settings") or {}).get("socket_mode_enabled"): errors.append("socket mode is off")
for e in errors:
    print("FAIL:", e, file=sys.stderr)
sys.exit(1 if errors else 0)
PY
pass "Slack app talks in channels only, over Socket Mode"

# Questions are ticket comments under the Question label; the old question entity is gone.
if git grep --untracked -nIE 'bb_question|bakers_question_|client_id: *hermes|bring_in_expert|chat_thread' -- "$BOT"; then
  fail "pm-bot names a question tool, the hermes OAuth client, the expert hand-in or the chat_thread field"
fi
pass "no question entity, OAuth client, expert hand-in or chat_thread field"

# Every user in the allowed channels by default; SLACK_ALLOWED_USERS restricts.
grep -qF '[ -n "${SLACK_ALLOWED_USERS:-}" ] || export GATEWAY_ALLOW_ALL_USERS=true' "$BOT/entrypoint.sh" \
  || fail "entrypoint.sh does not serve every user when SLACK_ALLOWED_USERS is empty"
pass "every user in the allowed channels unless SLACK_ALLOWED_USERS is set"

# The poller and the relay relay; they never call a model.
if git grep --untracked -nIiE 'anthropic|openai|api\.claude|/v1/messages|completions' -- "$BOT/poller" "$BOT/relay" "$BOT/lib"; then
  fail "poller, relay or client call an LLM"
fi
pass "poller, relay and client make no LLM call"

# Customer specifics live in the env file only; .env.example may show them as examples.
if git grep --untracked -nIiE 'pnf|park ?(and|&|n) ?fly' -- "$BOT" ":!$BOT/.env.example"; then
  fail "a customer literal appears in pm-bot/ outside .env.example"
fi
pass "no customer literal outside .env.example"

# The relay passes a clear answer on at once; a confirmation round must not come back.
if git grep -nIiE 'correct\?|confirm' -- "$BOT/SOUL.md" "$BOT/skills/project-manager/SKILL.md" "$BOT/README.md"; then
  fail "persona, skill or runbook asks the thread to confirm an answer before passing it on"
fi
pass "relay passes answers on without a confirmation round"

# AI agents work the tickets through bakers.build; customer wording describes events, not a team.
if git grep -nIiwE 'team' -- "$BOT/SOUL.md" "$BOT/skills/project-manager/SKILL.md" "$BOT/poller/messages.json" "$BOT/relay/server.mjs"; then
  fail "customer wording credits a team"
fi
pass "customer wording says what happens, not what a team does"

git check-ignore -q "$BOT/.env" || fail "$BOT/.env is not ignored"
pass "$BOT/.env is ignored"

if git grep --untracked -nIE 'xox[abp]-[0-9]{6,}-|xapp-[0-9]-[0-9A-Z]{6,}|sk-ant-[a-z]+[0-9]{2}-[0-9A-Za-z_-]{20,}' -- "$BOT"; then
  fail "a committed file under $BOT holds a token"
fi
pass "no token committed under $BOT"

# The bot runs from its image; nothing installs it.
if [ -e "$BOT/bin" ] || [ -e "$BOT/lib/running.sh" ] || [ -n "$(git ls-files "$BOT/bin" "$BOT/lib/running.sh")" ]; then
  fail "$BOT/bin/ or $BOT/lib/running.sh is back"
fi
pass "no install script for the bot"

COMPOSE=coder/bakers-ddev/pm-bot.compose.yaml
[ -f "$COMPOSE" ] || fail "$COMPOSE is missing"
python3 - "$COMPOSE" <<'PY' || fail "$COMPOSE breaks the container's lock-down (see above)"
import sys, yaml

with open(sys.argv[1]) as fh:
    text = fh.read()
compose = yaml.safe_load(text)

errors = []
def need(cond, msg):
    if not cond:
        errors.append(msg)

services = compose.get("services") or {}
need(list(services) == ["pm-bot"], f"services are {sorted(services)}, not one pm-bot")
svc = services.get("pm-bot") or {}
need(svc.get("image") == "${PM_BOT_IMAGE}", "the image is not ${PM_BOT_IMAGE}")
need(svc.get("restart") == "unless-stopped", "restart is not unless-stopped")
need(svc.get("env_file") in ("${PM_BOT_DATA}/.env", ["${PM_BOT_DATA}/.env"]), "env_file is not ${PM_BOT_DATA}/.env")
vols = [str(v) for v in svc.get("volumes") or []]
need(vols == ["${PM_BOT_DATA}:/opt/data", "${PM_BOT_CLONE}:/opt/clone:ro"],
     f"volumes are {vols}, not the data directory and the read-only clone")
need("docker.sock" not in text, "the Docker socket appears in the compose file")
for key in ("privileged", "pid", "ipc", "network_mode", "devices", "volumes_from", "user", "cgroup_parent"):
    need(key not in svc, f"{key} is set")
need(svc.get("cap_drop") == ["ALL"], "cap_drop is not [ALL]")
need(sorted(svc.get("cap_add") or []) == ["CHOWN", "DAC_OVERRIDE", "SETGID", "SETUID"],
     f"cap_add is {svc.get('cap_add')}, not CHOWN, DAC_OVERRIDE, SETGID, SETUID")
need("no-new-privileges:true" in (svc.get("security_opt") or []), "no-new-privileges is not set")
env = svc.get("environment") or {}
need(env.get("HERMES_UID") == "${PM_BOT_UID}" and env.get("HERMES_GID") == "${PM_BOT_GID}",
     "HERMES_UID and HERMES_GID are not the workspace user's")
for e in errors:
    print("FAIL:", e, file=sys.stderr)
sys.exit(1 if errors else 0)
PY
pass "compose: two mounts (clone read-only), no Docker socket, unless-stopped, capabilities dropped"

echo "OK: pm-bot lock-down and configurability contract holds"
