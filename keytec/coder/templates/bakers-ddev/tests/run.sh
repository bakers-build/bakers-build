#!/usr/bin/env bash
# Runs every tests/*.test.sh, or the ones named: tests/run.sh [git-setup frp-setup …]. Needs bash, git and node.
set -uo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
status=0
if [ $# -eq 0 ]; then set -- "$dir"/*.test.sh; else set -- "${@/#/$dir/}"; set -- "${@/%/.test.sh}"; fi
for t in "$@"; do
  echo "# $(basename "$t" .test.sh)"
  bash "$t" || status=1
done
[ "$status" -eq 0 ] && echo "all passed" || echo "some failed"
exit "$status"
