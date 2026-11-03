#!/usr/bin/env bash
# Validate recorded evidence only; never run commands or clean resources from a manifest.
set -euo pipefail
fail() { echo "Invalid acceptance input: $*" >&2; exit 2; }
[[ $# == 2 ]] || fail 'usage: clean-install-acceptance.sh MANIFEST.json NEW-REPORT.json'
command -v jq >/dev/null || fail 'jq is required'
[[ -f "$1" ]] || fail 'manifest must be a regular file'
jq -se 'length == 1' "$1" >/dev/null || fail 'expected one JSON document'
jq -e '
  has("candidate") and .schema == 1 and
  (.checks | type == "array" and length == 16) and
  (.prerequisites | has("clean_host") and has("public_artifacts") and has("clearance") and has("sandbox") and has("private_reporting")) and
  (.cleanup | has("status") and has("evidence"))
' "$1" >/dev/null || fail 'incomplete manifest'
identity=$(jq -Sc '.candidate' "$1" | sha256sum | cut -d' ' -f1)
report=$(jq -e --arg identity "$identity" '
  def text: type == "string" and test("\\S");
  def sha: type == "string" and test("^[0-9a-f]{40}$");
  def observation: (.status | IN("passed","failed","blocked","not_run")) and (.evidence | text);
  . as $m |
  if (
    (.harness_sha | sha) and
    (.environment | [.owner,.host,.os,.architecture,.tools] | all(.[]; text)) and
    (.prerequisites | all(.[]; observation)) and
    (.cleanup | observation) and
    (.candidate == null or (.candidate |
      (.source_url | text) and (.source_sha | sha) and (.docs_sha | sha) and
      (.packages | type == "array" and length > 0 and all(.[];
        (.name | text) and (.version | type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$")) and
        (.integrity | type == "string" and test("^sha512-[A-Za-z0-9+/]{86}==$")))) and
      (.images | type == "array" and length > 0 and all(.[]; type == "string" and test("^.+@sha256:[0-9a-f]{64}$"))) and
      (.skills | type == "array" and length > 0 and all(.[]; (.source | text) and (.revision | sha)))
    )) and
    ([.checks[].id] | sort == (["P1","P2","P3","P4","P5","F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11"] | sort)) and
    (all(.checks[];
      (.status | IN("passed","failed","blocked","not_run")) and
      (.acs | type == "array" and length > 0 and all(.[]; type == "string" and test("^AC-[1-7]$"))) and
      ([.actor,.environment,.command,.expected,.observed,.reference,.cleanup] | all(.[]; text)) and
      (if (.status | IN("passed","failed")) then
        (($m.candidate != null and .candidate_id == $identity) or
         ((.id | IN("P1","P2","P3","P4")) and .candidate_id == ("harness:" + $m.harness_sha))) and
        (.timestamp | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")) and (.evidence | text)
       else (.candidate_id == "" or .candidate_id == $identity) end)
    )) and
    (.clients | type == "array" and all(.[];
      .status == "reused" and (.original_status | IN("passed","failed","blocked","not_run")) and
      (.revision | sha) and ([.client,.scope,.evidence,.reference] | all(.[]; text))))
  ) then . else error("invalid fields, candidate identity or check coverage") end |
  ([.prerequisites[].status, .cleanup.status, .checks[].status]) as $states |
  (if any($states[]; . == "failed") then "FAIL"
   elif .candidate == null or any($states[]; . != "passed") then "BLOCKED"
   else "PASS" end) as $verdict |
  if .verdict != $verdict then error("declared verdict contradicts evidence")
  else . + {candidate_id:$identity, verdict:$verdict} end
' "$1") || fail 'evidence validation failed'
# Refuse existing files and symlinks, including parent symlinks. Publish exclusively.
[[ ! -e "$2" && ! -L "$2" ]] || fail 'report already exists'
parent=$(dirname -- "$2")
[[ -d "$parent" ]] || fail 'report parent does not exist'
[[ $(realpath -ms -- "$parent") == "$(realpath -m -- "$parent")" ]] || fail 'symlink report parent'
tmp=$(mktemp "$parent/.acceptance.XXXXXXXX")
trap 'rm -f -- "$tmp"' EXIT
printf '%s\n' "$report" > "$tmp"
ln -- "$tmp" "$2" || fail 'cannot publish report without overwriting'
verdict=$(jq -r '.verdict' <<< "$report")
printf '%s\n' "$verdict"
[[ $verdict == PASS ]]
