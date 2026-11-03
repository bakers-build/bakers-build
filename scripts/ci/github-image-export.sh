#!/usr/bin/env bash
set -euo pipefail
: "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
mkdir -p verified-images
jq -n --arg commit "$GITHUB_SHA" --arg tree "$(git rev-parse 'HEAD^{tree}')" \
  --arg run "$GITHUB_RUN_ID" --arg attempt "$GITHUB_RUN_ATTEMPT" \
  '{commit:$commit,tree:$tree,run:$run,attempt:$attempt}' > verified-images/candidate.json
for image in php nginx docs; do
  docker image inspect "bakers-gate/$image:local" > "verified-images/$image.json"
done
docker save bakers-gate/php:local bakers-gate/nginx:local bakers-gate/docs:local | gzip -1 > verified-images/images.tar.gz
(cd verified-images && sha256sum images.tar.gz > SHA256SUMS)
