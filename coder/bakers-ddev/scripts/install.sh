#!/usr/bin/env bash
# Coder agent startup script: installs the bakers.build worker tools into the home volume, once.
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
mkdir -p "$HOME/.local/bin" "$HOME/.local/tmp"
# Downloads land in ~/.local/tmp and move into place last (same volume, so the move is atomic):
# a start killed mid-download leaves no truncated binary for `command -v` to find.
rm -rf "$HOME/.local/tmp"/*

if command -v ss >/dev/null; then
  echo "ss: skipped (already installed)"
else
  echo "ss: installing iproute2 from the Ubuntu archive"
  tmp=$(mktemp -d -p "$HOME/.local/tmp")
  sudo apt-get update -qq
  (cd "$tmp" && apt-get download iproute2)
  dpkg-deb --fsys-tarfile "$tmp"/iproute2_*.deb | tar -x -C "$tmp" ./bin/ss
  mv "$tmp/bin/ss" "$HOME/.local/bin/ss"
  rm -rf "$tmp"
fi

if command -v bakers >/dev/null; then
  echo "bakers: skipped (already installed)"
else
  echo "bakers: installing $BB_VERSION"
  npm install -g "@bakers-build/bakers@$BB_VERSION"
fi

if command -v herdr >/dev/null; then
  echo "herdr: skipped (already installed)"
else
  echo "herdr: installing $HERDR_VERSION"
  tmp=$(mktemp -d -p "$HOME/.local/tmp")
  curl -fsSL -o "$tmp/herdr" "https://github.com/herdrdev/herdr/releases/download/v$HERDR_VERSION/herdr-linux-x86_64"
  chmod +x "$tmp/herdr"
  mv "$tmp/herdr" "$HOME/.local/bin/herdr"
  rm -rf "$tmp"
fi

if command -v claude >/dev/null; then
  echo "claude: skipped (already installed)"
else
  echo "claude: installing $CLAUDE_VERSION"
  curl -fsSL https://claude.ai/install.sh | bash -s "$CLAUDE_VERSION"
fi

if command -v codex >/dev/null; then
  echo "codex: skipped (already installed)"
else
  echo "codex: installing $CODEX_VERSION"
  npm install -g "@openai/codex@$CODEX_VERSION"
fi

# Cursor's own installer always installs the latest version; this follows its layout at a pinned one.
if command -v cursor-agent >/dev/null; then
  echo "cursor-agent: skipped (already installed)"
else
  echo "cursor-agent: installing $CURSOR_VERSION"
  tmp=$(mktemp -d -p "$HOME/.local/tmp")
  curl -fsSL "https://downloads.cursor.com/lab/$CURSOR_VERSION/linux/x64/agent-cli-package.tar.gz" | tar -xz --strip-components=1 -C "$tmp"
  mkdir -p "$HOME/.local/share/cursor-agent/versions"
  rm -rf "$HOME/.local/share/cursor-agent/versions/$CURSOR_VERSION"
  mv "$tmp" "$HOME/.local/share/cursor-agent/versions/$CURSOR_VERSION"
  ln -sf "$HOME/.local/share/cursor-agent/versions/$CURSOR_VERSION/cursor-agent" "$HOME/.local/bin/cursor-agent"
fi

if command -v gh >/dev/null; then
  echo "gh: skipped (already installed)"
else
  echo "gh: installing $GH_VERSION"
  tmp=$(mktemp -d -p "$HOME/.local/tmp")
  curl -fsSL "https://github.com/cli/cli/releases/download/v$GH_VERSION/gh_${GH_VERSION}_linux_amd64.tar.gz" | tar -xz -C "$tmp"
  mv "$tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" "$HOME/.local/bin/gh"
  rm -rf "$tmp"
fi

if command -v glab >/dev/null; then
  echo "glab: skipped (already installed)"
else
  echo "glab: installing $GLAB_VERSION"
  tmp=$(mktemp -d -p "$HOME/.local/tmp")
  curl -fsSL "https://gitlab.com/gitlab-org/cli/-/releases/v$GLAB_VERSION/downloads/glab_${GLAB_VERSION}_linux_amd64.tar.gz" | tar -xz -C "$tmp" bin/glab
  mv "$tmp/bin/glab" "$HOME/.local/bin/glab"
  rm -rf "$tmp"
fi

# The preview transport parameter (README › Optional previews) picks the tunnel client and writes
# machine.config.js; at none nothing is installed or started. The edit never fails the start.
preview="${PREVIEW_TRANSPORT:-none}"
node /usr/local/bin/bakers-preview-config "$preview" || true

if [ "$preview" = cloudflare-quick ] || [ "$preview" = cloudflare ]; then
  if command -v cloudflared >/dev/null; then
    echo "cloudflared: skipped (already installed)"
  else
    echo "cloudflared: installing $CLOUDFLARED_VERSION"
    tmp=$(mktemp -d -p "$HOME/.local/tmp")
    curl -fsSL -o "$tmp/cloudflared" "https://github.com/cloudflare/cloudflared/releases/download/$CLOUDFLARED_VERSION/cloudflared-linux-amd64"
    chmod +x "$tmp/cloudflared"
    mv "$tmp/cloudflared" "$HOME/.local/bin/cloudflared"
    rm -rf "$tmp"
  fi
fi

if [ "$preview" = frp ]; then
  if command -v frpc >/dev/null; then
    echo "frpc: skipped (already installed)"
  else
    echo "frpc: installing $FRP_VERSION"
    tmp=$(mktemp -d -p "$HOME/.local/tmp")
    curl -fsSL "https://github.com/fatedier/frp/releases/download/v$FRP_VERSION/frp_${FRP_VERSION}_linux_amd64.tar.gz" | tar -xz -C "$tmp"
    mv "$tmp/frp_${FRP_VERSION}_linux_amd64/frpc" "$HOME/.local/bin/frpc"
    rm -rf "$tmp"
  fi
fi

# Services run detached; the container's /tmp lives for one start. Conductors start below, when the
# workspace's conductor_autostart parameter is on.
# Own session (setsid): herdr treats a server outside one as not surviving SSH loss and refuses saved machines.
setsid nohup herdr server >"${TMPDIR:-/tmp}/herdr-server.log" 2>&1 </dev/null &

if [ "$preview" = frp ]; then
  if [ -f "$HOME/.config/frp/frpc.json" ]; then
    nohup frpc -c "$HOME/.config/frp/frpc.json" >"${TMPDIR:-/tmp}/frpc.log" 2>&1 </dev/null &
  else
    echo "frpc: not started, ~/.config/frp/frpc.json is missing"
  fi
fi

if [ "$preview" = cloudflare ]; then
  if [ -f "$HOME/.cloudflared/tunnel-token" ]; then
    nohup cloudflared tunnel run --token-file "$HOME/.cloudflared/tunnel-token" >"${TMPDIR:-/tmp}/cloudflared.log" 2>&1 </dev/null &
  else
    echo "cloudflared: not started, ~/.cloudflared/tunnel-token is missing"
  fi
fi

# The PM bot, when the workspace has its parameters (README › PM bot). It never fails the start.
# Through bash: the Docker upload makes it root-owned, so neither coder nor the bot can change it.
bash /usr/local/bin/pm-bot || true

# The workspace's conductors, when conductor_autostart is on (README › Conductor autostart). The
# startup script does not block the workspace, so this runs in line and its lines reach this log.
bash /usr/local/bin/bakers-conductors || true
