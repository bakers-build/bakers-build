#!/usr/bin/env bash
# Coder agent startup script of the keytec bakers-ddev template: configures, installs nothing. Every
# tool comes from the image at a pinned version (keytec/coder/images/keytec-coder); a version bump is
# a new image. Each step logs its own lines and never fails the start.
set -uo pipefail

S=/usr/local/share/bakers-ddev

bash "$S/git-setup.sh"
bash "$S/bakers-setup.sh"
bash "$S/projects.sh"

# FRP first, so the machine config gets the zone it was enrolled for.
frp=$(bash "$S/frp-setup.sh")
echo "$frp"
zone=$(sed -n 's/^frp: configured for //p' <<<"$frp")
node "$S/machine-config.mjs" ${zone:+--frp "$zone"}

# Codex settings from the image, only when the home has none.
if [ ! -f "$HOME/.codex/config.toml" ]; then
  mkdir -p "$HOME/.codex" && cp /usr/local/share/bakers-ddev/codex-config.toml "$HOME/.codex/config.toml" &&
    echo "codex: config.toml written"
fi

# Own session (setsid): herdr treats a server outside one as not surviving SSH loss and refuses saved machines.
setsid nohup herdr server >"${TMPDIR:-/tmp}/herdr-server.log" 2>&1 </dev/null &
echo "herdr: started"

# The PM bot, when the workspace has its parameters (README › PM bot). Through bash: the Docker
# upload makes it root-owned, so neither coder nor the bot can change it.
bash /usr/local/bin/pm-bot || true

# The workspace's conductors, when conductor_autostart is on (README › Conductor autostart).
bash /usr/local/bin/bakers-conductors || true

# The dashboard's conductor item reads this loop's snapshot (README › Health).
setsid nohup bash "$S/health.sh" conductor-loop >/dev/null 2>&1 </dev/null &
echo "health: loop started"
exit 0
