# THROWAWAY spike image: one container per agent run (docs/decisions/run-isolation.md).
# The bakers CLI is not baked in: the run mounts the host's build read-only at its host path,
# because the agent command names its wrapper scripts by that path.
FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code \
 && mkdir -m 0777 /home/run
ENV HOME=/home/run
