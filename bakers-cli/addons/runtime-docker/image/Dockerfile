# One container per agent run (@bakers-build/addon-runtime-docker). The bakers CLI
# is not baked in: each run mounts the host build read-only at its host path,
# because the agent command names the CLI's scripts by that path.
FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# The agent's own install (its `installCommand`); one image per agent.
ARG AGENT_INSTALL
RUN test -n "$AGENT_INSTALL" && sh -c "$AGENT_INSTALL"
COPY proxy.mjs /opt/bb-runtime/proxy.mjs
