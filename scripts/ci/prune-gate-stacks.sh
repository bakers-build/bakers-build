#!/bin/bash
# Remove merge-gate compose stacks (e2e-<job>, config-install-<job>) older than two hours from
# the deploy runner's host daemon: a job killed before its after_script leaves one behind.
# No gate job runs that long (e2e times out at 45 minutes).
set -euo pipefail
now="$(date -u +%s)"
docker ps -a --filter label=com.docker.compose.project --format '{{.Label "com.docker.compose.project"}}' \
  | sort -u | grep -E '^(e2e|config-install)-[0-9]+$' | while read -r project; do
  created="$(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.ID}}' \
    | head -1 | xargs docker inspect -f '{{.Created}}')"
  # 2026-10-23T09:00:00.123456789Z -> 2026-10-23 09:00:00, which busybox date reads.
  created="$(date -u -d "$(echo "$created" | sed 's/T/ /; s/\..*//; s/Z$//')" +%s)"
  if [ $((now - created)) -gt 7200 ]; then
    echo "Removing stale gate stack $project"
    docker compose -p "$project" down -v --remove-orphans
  fi
done || true
