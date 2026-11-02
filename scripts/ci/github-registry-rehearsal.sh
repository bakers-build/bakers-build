#!/usr/bin/env bash
set -euo pipefail
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}"
owner=${GITHUB_REPOSITORY%%/*}
# Dedicated package names keep rehearsal images away from release channels.
prefix=bakers-rehearsal
images=(php nginx docs)
mkdir -p gate-reports
for image in "${images[@]}"; do
  response=$(mktemp)
  code=$(curl -sS -o "$response" -w '%{http_code}' -H "Authorization: Bearer $GH_TOKEN" \
    "https://api.github.com/orgs/$owner/packages/container/$prefix-$image")
  case "$code" in
    200) jq -e '.visibility == "private"' "$response" > /dev/null ;;
    404) ;; # First publication is private by GitHub's registry contract.
    *) cat "$response" >&2; rm -f "$response"; exit 1 ;;
  esac
  rm -f "$response"
done
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
trap 'docker logout ghcr.io > /dev/null 2>&1 || true' EXIT
for image in "${images[@]}"; do
  target="ghcr.io/$owner/$prefix-$image:sha-$GITHUB_SHA-run-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  expected=$(docker image inspect "bakers-gate/$image:local" --format '{{.Id}}')
  docker tag "bakers-gate/$image:local" "$target"
  docker push "$target"
  gh api "orgs/$owner/packages/container/$prefix-$image" --jq '.visibility' | grep -qx private
  digest=$(docker image inspect "$target" --format '{{index .RepoDigests 0}}')
  docker pull "$digest"
  actual=$(docker image inspect "$digest" --format '{{.Id}}')
  test "$expected" = "$actual"
  printf '%s %s %s\n' "$image" "$digest" "$actual" >> gate-reports/registry.txt
done
