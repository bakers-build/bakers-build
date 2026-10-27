#!/usr/bin/env bash
# scripts/ci/phpunit-shard.sh deals every unit-kernel test file into exactly one shard.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"; rm -f phpunit.shard.xml' EXIT

for d in $(sed -n '/<testsuite name="unit-kernel">/,/<\/testsuite>/s:.*<directory>\./\(.*\)</directory>.*:\1:p' phpunit.xml); do
  [ -d "$d" ] && find "$d" -name '*Test.php'
done | sed 's:^:./:' | sort > "$tmp/all"
for i in 1 2; do
  bash scripts/ci/phpunit-shard.sh "$i" 2 >/dev/null
  grep -o '<file>[^<]*' phpunit.shard.xml | sed 's/<file>//' > "$tmp/$i"
  grep -q '<directory>' <(sed -n '/<testsuite name="unit-kernel">/,/<\/testsuite>/p' phpunit.shard.xml) \
    && { echo "FAIL: shard $i keeps a unit-kernel <directory>"; exit 1; }
done
[ -s "$tmp/1" ] && [ -s "$tmp/2" ] || { echo "FAIL: a shard is empty"; exit 1; }
[ -z "$(sort "$tmp/1" "$tmp/2" | uniq -d)" ] || { echo "FAIL: a test file is in both shards"; exit 1; }
sort "$tmp/1" "$tmp/2" | cmp -s - "$tmp/all" || { echo "FAIL: the shards do not cover the unit-kernel suite"; exit 1; }
echo "ok: phpunit shards cover $(wc -l < "$tmp/all") unit-kernel files once each"
