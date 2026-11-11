# One container per agent run (@bakers-build/addon-runtime-docker). The bakers CLI
# is not baked in: each run mounts the host build read-only at its host path,
# because the agent command names the CLI's scripts by that path.
FROM node:22-slim
ARG CLAUDE_CODE_VERSION=latest
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && mkdir -m 0777 /home/run
ENV HOME=/home/run
