# keytec-coder workspace image: coder-drupal-ddev-base (Ubuntu 24.04, user coder, Docker,
# Node 22, DDEV) plus every tool a bakers.build box runs, pinned and installed as root under
# /usr/local, so the home volume holds data only. A version bump is a new build (README).
ARG BASE_IMAGE=git.key-tec.de:5050/keytec/infra/coder-drupal-ddev-base:3.2.5
FROM ${BASE_IMAGE}

ARG BAKERS_VERSION=0.7.0
ARG HERDR_VERSION=0.9.5
ARG CLAUDE_VERSION=2.1.306
ARG CODEX_VERSION=0.163.0
ARG CURSOR_VERSION=2026.10.19-6bbf2c4
ARG GH_VERSION=2.102.1
ARG GLAB_VERSION=1.124.0
ARG CLOUDFLARED_VERSION=2026.10.2
ARG FRP_VERSION=0.68.0
ARG PLAYWRIGHT_VERSION=1.65.0

USER root
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ss for the ports addons.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends iproute2 \
  && rm -rf /var/lib/apt/lists/*

# npm tools, into /usr/local (the base's npm prefix is the coder home, a volume).
RUN npm install -g --prefix /usr/local \
    "@bakers-build/bakers@${BAKERS_VERSION}" \
    "@openai/codex@${CODEX_VERSION}" \
    "playwright@${PLAYWRIGHT_VERSION}" \
  && npm cache clean --force

# Single binaries.
RUN curl -fsSL -o /usr/local/bin/herdr "https://github.com/herdrdev/herdr/releases/download/v${HERDR_VERSION}/herdr-linux-x86_64" \
  && curl -fsSL -o /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64" \
  && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin --strip-components=2 "gh_${GH_VERSION}_linux_amd64/bin/gh" \
  && curl -fsSL "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin --strip-components=1 bin/glab \
  && curl -fsSL "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin --strip-components=1 "frp_${FRP_VERSION}_linux_amd64/frpc" \
  && chmod 755 /usr/local/bin/herdr /usr/local/bin/cloudflared /usr/local/bin/gh /usr/local/bin/glab /usr/local/bin/frpc

# Cursor's installer always takes the latest version; this follows its layout at a pinned one.
RUN mkdir -p "/usr/local/share/cursor-agent/${CURSOR_VERSION}" \
  && curl -fsSL "https://downloads.cursor.com/lab/${CURSOR_VERSION}/linux/x64/agent-cli-package.tar.gz" \
    | tar -xz --strip-components=1 -C "/usr/local/share/cursor-agent/${CURSOR_VERSION}" \
  && ln -sf "/usr/local/share/cursor-agent/${CURSOR_VERSION}/cursor-agent" /usr/local/bin/cursor-agent

# Claude Code's native build: the installer puts it under root's home; the binary is self-contained.
RUN curl -fsSL https://claude.ai/install.sh | bash -s "${CLAUDE_VERSION}" \
  && cp -L /root/.local/bin/claude /usr/local/bin/claude \
  && rm -rf /root/.local/share/claude /root/.local/bin/claude /root/.claude

# Chromium for the pinned Playwright, with its system libraries. Writable by coder, so a project
# whose Playwright pins another version can add its browser here (it lasts until the next rebuild).
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN playwright install --with-deps chromium \
  && chown -R coder:coder /opt/ms-playwright \
  && rm -rf /var/lib/apt/lists/*

# Nothing updates itself on start: Claude Code reads this, the template sets it for every session too.
ENV DISABLE_AUTOUPDATER=1

COPY files/managed-settings.json /etc/claude-code/managed-settings.json
COPY files/codex-config.toml files/smoke.sh /usr/local/share/bakers-ddev/
RUN chmod 644 /etc/claude-code/managed-settings.json /usr/local/share/bakers-ddev/codex-config.toml \
  && chmod 755 /usr/local/share/bakers-ddev/smoke.sh

USER coder
