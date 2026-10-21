# BB-658 Task 3 — MCP service image.
#
# Hosts the upstream @dropsh/plugin-mcp Streamable HTTP server. Verified at the
# pinned commit (plugins/mcp/src/transports.ts, dropsh repo): the HTTP listener
# binds "127.0.0.1" as a hardcoded literal with no flag/env override, and
# requires the inbound Host header to equal "127.0.0.1:<port>" exactly. Only a
# process sharing THIS container's network namespace can ever reach it, so the
# public-facing hop is terminated by nginx running in the SAME container, which
# rewrites Host to the literal the plugin demands and proxies through.
#
# @dropsh/plugin-mcp is not yet published to npm (verified: `npm view
# @dropsh/plugin-mcp` 404s at time of writing) even though dropsh core is, so
# it is built from the pinned commit instead of installed from the registry.
FROM node:22-bookworm-slim

ARG DROPSH_COMMIT=ae67d761995fc63239de6da8e7ab985e2545c379
ARG DROPSH_REPO=https://github.com/pen-drop/dropsh.git

RUN apt-get update \
    && apt-get install -y --no-install-recommends git nginx ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Matches dropsh's own pinned packageManager (package.json: pnpm@10.29.1).
RUN corepack enable && corepack prepare pnpm@10.29.1 --activate

WORKDIR /opt/dropsh
RUN git init -q . \
    && git remote add origin "$DROPSH_REPO" \
    && git fetch --depth 1 origin "$DROPSH_COMMIT" \
    && git checkout -q FETCH_HEAD
RUN pnpm install --frozen-lockfile
RUN pnpm run build && pnpm run build:packages && pnpm run build:plugins

# BB-658 review F3: the root package.json declares no dependency on the
# workspace plugin packages, so pnpm never links them into the root
# node_modules/@dropsh/*. dropsh.config.js (placed at this same directory,
# below) resolves its configured plugins with Node's normal `require`
# algorithm starting from the config file's own directory, which needs
# exactly those symlinks. Create them directly from the already-built
# workspace packages instead of adding a fake dependency and reinstalling.
RUN mkdir -p node_modules/@dropsh \
    && ln -s ../../plugins/jsonapi-schema node_modules/@dropsh/plugin-jsonapi-schema \
    && ln -s ../../plugins/mcp node_modules/@dropsh/plugin-mcp

COPY docker/mcp/dropsh.config.js /opt/dropsh/dropsh.config.js
COPY docker/mcp/nginx.conf /etc/nginx/sites-enabled/default
COPY docker/mcp/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /opt/dropsh
# Proxy listens here; the MCP process itself stays loopback-only (8787) inside
# this same container, unreachable from outside it.
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
