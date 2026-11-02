#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
checker="$root/scripts/clean-install-acceptance.sh"
# Missing candidate evidence must never produce release acceptance.
printf '{"schema":1,"candidate":null,"checks":[],"clients":[],"prerequisites":{},"cleanup":{},"verdict":"BLOCKED"}\n' > "$tmp/input.json"
set +e
bash "$checker" "$tmp/input.json" "$tmp/result.json" > "$tmp/log" 2>&1
code=$?
set -e
[[ $code == 2 && ! -e "$tmp/result.json" ]] || { cat "$tmp/log"; echo 'FAIL: incomplete manifest accepted'; exit 1; }
echo 'PASS: incomplete manifest rejected without output'
jq -n '{schema:1, harness_sha:("a"*40), candidate:{source_url:"https://example.test/source.git", source_sha:("b"*40), docs_sha:("b"*40), packages:[{name:"@example/cli",version:"1.0.0-next.1",integrity:("sha512-"+("a"*86)+"==")}], images:["example.test/php@sha256:"+("c"*64)], skills:[{source:"https://example.test/skills.git",revision:("d"*40)}]}, environment:{owner:"fixture",host:"disposable fixture",os:"Linux fixture",architecture:"x86_64",tools:"Git 2, Node 24, Bash 5, jq 1.7 (synthetic)"}, prerequisites:(["clean_host","public_artifacts","clearance","sandbox","private_reporting"]|map({key:.,value:{status:"passed",evidence:"fixture observation"}})|from_entries), cleanup:{status:"passed",evidence:"owned fixture resources removed; sentinel unchanged"}, clients:[], verdict:"PASS", checks:(["P1","P2","P3","P4","P5","F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11"]|map({id:.,acs:["AC-1"],status:"passed",actor:"fixture actor",environment:"fixture host",candidate_id:"",command:"synthetic observation",expected:"fixture success",observed:"fixture success",timestamp:"2026-11-02T12:00:00Z",evidence:"fixture evidence",reference:"synthetic",cleanup:"owned resources removed"}))}' > "$tmp/complete.json"
identity=$(jq -Sc '.candidate' "$tmp/complete.json" | sha256sum | cut -d' ' -f1)
jq --arg id "$identity" '.checks[].candidate_id=$id' "$tmp/complete.json" > "$tmp/valid.json"
bash "$checker" "$tmp/valid.json" "$tmp/pass.json"
jq -e '.verdict == "PASS" and (.checks | length == 16)' "$tmp/pass.json" >/dev/null
printf 'PASS: complete synthetic evidence accepted\n'
run_case() {
  local label=$1 filter=$2 expected=$3 verdict=$4
  jq "$filter" "$tmp/valid.json" > "$tmp/case.json"
  rm -f "$tmp/case-report.json"
  set +e
  bash "$checker" "$tmp/case.json" "$tmp/case-report.json" > "$tmp/log" 2>&1
  local code=$?
  set -e
  [[ $code == "$expected" ]] || { cat "$tmp/log"; echo "FAIL: $label (exit $code)"; exit 1; }
  if [[ $expected == 2 ]]; then
    [[ ! -e "$tmp/case-report.json" ]] || exit 1
  else
    jq -e --arg verdict "$verdict" '.verdict == $verdict' "$tmp/case-report.json" >/dev/null
  fi
  echo "PASS: $label"
}
run_case 'failure survives aggregation' '.checks[0].status="failed" | .verdict="FAIL"' 1 FAIL
run_case 'false PASS refused' '.checks[0].status="failed"' 2 ''
run_case 'pending check blocks acceptance' '.checks[0].status="not_run" | .verdict="BLOCKED"' 1 BLOCKED
run_case 'cleanup blocks acceptance' '.cleanup.status="blocked" | .verdict="BLOCKED"' 1 BLOCKED
run_case 'private credentials cannot pass' '.prerequisites.clean_host.status="failed" | .verdict="FAIL"' 1 FAIL
run_case 'missing public candidate is blocked' '.candidate=null | .checks |= map(.status="blocked" | .candidate_id="") | .verdict="BLOCKED"' 1 BLOCKED
run_case 'missing fields refused' 'del(.harness_sha)' 2 ''
run_case 'missing path refused' '.checks |= .[1:]' 2 ''
run_case 'duplicate path refused' '.checks[0].id="P2"' 2 ''
run_case 'different revision refused' '.checks[0].candidate_id="stale"' 2 ''
run_case 'moving artifact tag refused' '.candidate.images=["image:next"]' 2 ''
run_case 'empty observation refused' '.checks[0].observed=" "' 2 ''
run_case 'reused smoke cannot pass' '.checks[9].status="reused"' 2 ''
run_case 'reused evidence needs provenance' '.clients=[{status:"reused"}]' 2 ''
run_case 'supplemental evidence retains original failure' '.clients=[{status:"reused",original_status:"failed",revision:("c"*40),client:"fixture",scope:"different older version, not this smoke",evidence:"fixture",reference:"fixture defect"}]' 0 PASS
printf 'sentinel\n' > "$tmp/existing"
cp "$tmp/existing" "$tmp/before"
if bash "$checker" "$tmp/valid.json" "$tmp/existing" >/dev/null 2>&1; then exit 1; fi
cmp "$tmp/before" "$tmp/existing"
ln -s "$tmp/existing" "$tmp/link"
if bash "$checker" "$tmp/valid.json" "$tmp/link" >/dev/null 2>&1; then exit 1; fi
cmp "$tmp/before" "$tmp/existing"
mkdir "$tmp/reports"
ln -s "$tmp/reports" "$tmp/linked-parent"
if bash "$checker" "$tmp/valid.json" "$tmp/linked-parent/result" >/dev/null 2>&1; then exit 1; fi
[[ ! -e "$tmp/reports/result" ]]
# Commands and cleanup text are evidence, never executable input.
jq --arg command "touch $tmp/INJECTED" '.checks[0].command=$command | .cleanup.evidence=$command' "$tmp/valid.json" > "$tmp/untrusted.json"
bash "$checker" "$tmp/untrusted.json" "$tmp/untrusted-report.json" >/dev/null
[[ ! -e "$tmp/INJECTED" ]]
echo 'PASS: existing files, symlinks and unrelated data preserved; command text inert'
run_case 'local checks retain evidence without a public candidate' '.candidate=null | .checks |= map(.status="blocked" | .candidate_id="") | .checks[0].status="passed" | .checks[0].candidate_id=("harness:"+.harness_sha) | .verdict="BLOCKED"' 1 BLOCKED
