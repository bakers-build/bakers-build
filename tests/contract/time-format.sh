#!/usr/bin/env bash
set -euo pipefail

# One formatting path for every displayed time and duration.
#
# `Drupal\bb_core\Time\BbDate` owns the rules — relative under seven days,
# "15 Jun, 13:30" older, "15 Jun 2025" in another year, durations as
# "41s" / "36 min" / "1h 10m" — and `bb_theme:time` renders the
# `<time datetime title>`. This suite fails when a second path appears:
#
#   1. PHP under web/modules/custom calls Drupal's date formatter, TimeDiff or
#      formatInterval itself, formats a display date with date()/gmdate(), or
#      glues a raw "s" onto a second count.
#   2. Twig under the theme or the modules formats a date with `|date` or
#      `format_date`.
#   3. A view or entity display in config/sync or recipes/bakers/config uses
#      core's `timestamp` / `timestamp_ago` formatter instead of `bb_time`.
#
# Every exemption is a named file with its reason. A new hit is either routed
# through BbDate or added here with a reason a reviewer can disagree with.

cd "$(dirname "$0")/../.."

fail=0
report() {
  printf 'FAIL: %s\n%s\n' "$1" "$2"
  fail=1
}

# Files allowed to format time themselves, and why.
php_allow=(
  # The one path.
  'web/modules/custom/bb_core/src/Time/BbDate.php'
  # Machine-readable stamps for the API and stored figures, not display.
  'web/modules/custom/bb_core/src/Plugin/tool/Tool/TicketRead.php'
  'web/modules/custom/bb_core/src/Statistics/Figure/FigureEvaluator.php'
  # Date math: today's UTC date as a period anchor.
  'web/modules/custom/bb_core/src/Statistics/MyWorkStatsPage.php'
  'web/modules/custom/bb_core/src/Statistics/InsightsPage.php'
  'web/modules/custom/bb_track/src/Statistics/BillingReportPage.php'
  # The chart's "as of HH:MM UTC" stamp.
  'web/modules/custom/bb_core/src/Statistics/FigureRenderer.php'
)

allowed() {
  local file=$1 entry
  for entry in "${php_allow[@]}"; do
    [[ $file == "$entry" ]] && return 0
  done
  return 1
}

# Check 0: the enumeration reaches PHP at all, or every "no hit" below is vacuous.
php_count=$(git ls-files -- 'web/modules/custom/*.php' | grep -vc '/tests/' || true)
if [[ $php_count -lt 100 ]]; then
  report 'enumeration' "  only $php_count PHP files found under web/modules/custom"
fi

quote="['\"]"
php_pattern='dateFormatter(\(\))?->format(TimeDiff|Interval|Diff)?\(|date\.formatter.\)->format|->formatTimeDiff(Since|Until)\(|->formatInterval\(|[^_a-zA-Z0-9>:$](gm)?date\('"$quote"'|\. '"$quote"'s'"$quote"'[;),]'
hits=''
while IFS= read -r line; do
  file=${line%%:*}
  allowed "$file" || hits+="  $line"$'\n'
done < <(git grep -nE "$php_pattern" -- 'web/modules/custom/*.php' 'web/modules/custom/*.module' 'web/modules/custom/*.theme' | grep -v '/tests/' || true)
[[ -n $hits ]] && report 'PHP formats a time or duration outside BbDate' "$hits"

twig_hits=$(git grep -nE '\|[[:space:]]*date\(|format_date' -- 'web/themes/custom/*.twig' 'web/modules/custom/*.twig' || true)
[[ -n $twig_hits ]] && report 'Twig formats a date' "$twig_hits"

# Drupal's own admin listings keep core formatters: they are not product UI.
config_allow='views\.view\.(files|groups|projects|runs|tickets|user_admin_people|machines)\.yml'
config_hits=$(git grep -nE '^[[:space:]]*type: timestamp(_ago)?$' -- config/sync recipes/bakers/config | grep -Ev "/$config_allow:" || true)
[[ -n $config_hits ]] && report 'config uses a core timestamp formatter instead of bb_time' "$config_hits"

if [[ $fail -eq 0 ]]; then
  printf 'PASS: every displayed time and duration goes through BbDate\n'
fi
exit $fail
