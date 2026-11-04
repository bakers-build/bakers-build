#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_HEAD:?}" "${SOURCE_RUN_ID:?}" "${SOURCE_RUN_ATTEMPT:?}"
jq -e --arg commit "$RELEASE_HEAD" --arg tree "$(git rev-parse 'HEAD^{tree}')" \
  --arg run "$SOURCE_RUN_ID" --arg attempt "$SOURCE_RUN_ATTEMPT" \
  '.commit==$commit and .tree==$tree and .run==$run and .attempt==$attempt' \
  verified-images/candidate.json > /dev/null
(cd verified-images && sha256sum images.tar.gz | cmp - SHA256SUMS)
gzip -dc verified-images/images.tar.gz | docker load
mkdir -p gate-reports
cp verified-images/candidate.json gate-reports/imported-candidate.json
for image in php nginx docs pm-bot; do
  docker image inspect "bakers-gate/$image:local" > "gate-reports/$image.json"
  jq -e --slurpfile expected "verified-images/$image.json" \
    '.[0].Id == $expected[0][0].Id and .[0].RootFS.Layers == $expected[0][0].RootFS.Layers' \
    "gate-reports/$image.json" > /dev/null
done
