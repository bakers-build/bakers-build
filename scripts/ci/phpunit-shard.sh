#!/bin/bash
# Write phpunit.shard.xml: phpunit.xml with its `unit-kernel` suite cut to shard <index> of <total>.
#
#   bash scripts/ci/phpunit-shard.sh <index> <total>   # 1-based, e.g. CI_NODE_INDEX CI_NODE_TOTAL
#
# The test files are the suite's own globs, sorted and dealt round-robin, so every file lands in
# exactly one shard and the split is the same on every run. Run from the repository root.
set -euo pipefail
index="${1:?shard index}" total="${2:?shard total}"

# The four <directory> globs of phpunit.xml's unit-kernel suite.
dirs="$(sed -n '/<testsuite name="unit-kernel">/,/<\/testsuite>/s:.*<directory>\./\(.*\)</directory>.*:\1:p' phpunit.xml)"
[ -n "$dirs" ] || { echo "phpunit.xml has no unit-kernel directories" >&2; exit 1; }

# shellcheck disable=SC2086  # the globs expand here on purpose
files="$(for d in $dirs; do [ -d "$d" ] && find "$d" -name '*Test.php'; done | sort \
  | awk -v i="$index" -v n="$total" '(NR - 1) % n == i - 1 { print "      <file>./" $0 "</file>" }')"
[ -n "$files" ] || { echo "shard $index/$total selects no test file" >&2; exit 1; }

awk -v files="$files" '
  /<testsuite name="unit-kernel">/ { print; print files; skip = 1; next }
  skip && /<\/testsuite>/ { skip = 0 }
  !skip
' phpunit.xml > phpunit.shard.xml
echo "shard $index/$total: $(grep -c '<file>' phpunit.shard.xml) test files"
