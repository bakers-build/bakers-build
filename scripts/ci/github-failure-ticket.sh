#!/usr/bin/env bash
# Files a failed scheduled `GitHub checks` run in bakers.build: comments on the open CI-failure
# ticket if there is one, otherwise creates a bug. Needs a signed-in `bakers` CLI.
# Inputs: FAILED_JOBS, GITHUB_SHA, RUN_URL.
set -euo pipefail

: "${FAILED_JOBS:?}" "${GITHUB_SHA:?}" "${RUN_URL:?}"
export TITLE='CI failure: scheduled GitHub checks on next'
# Project BAKERS; ticket search accepts only the UUID, not the key.
export PROJECT=07ab22a7-49ee-479d-8431-7202f5235898
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# JSON is built with node so job names and URLs cannot break the quoting.
node -e 'process.stdout.write(JSON.stringify({query: process.env.TITLE, project: process.env.PROJECT}))' \
  >"$work/search.json"
bakers tools tool_api__bakers_ticket_search --data @"$work/search.json" >"$work/found.json"

node - "$work" <<'NODE'
const fs = require('fs');
const dir = process.argv[2];
const env = process.env;
const { tickets = [] } = JSON.parse(fs.readFileSync(`${dir}/found.json`, 'utf8'));
const open = tickets.find((t) => t.title.startsWith(env.TITLE) && t.state !== 'done');
const body = [
  'Scheduled `GitHub checks` failed on `next`.',
  '',
  `- Failed jobs: ${env.FAILED_JOBS}`,
  `- Commit: ${env.GITHUB_SHA}`,
  `- Run: ${env.RUN_URL}`,
  '',
].join('\n');
const [tool, args] = open
  ? ['bakers_comment_publish', { ticket: open.identifier, type: 'comment', body }]
  : ['bakers_ticket_create', {
      title: env.TITLE, project: env.PROJECT, workflow: 'bb_work', type: 'bug', description: body,
    }];
fs.writeFileSync(`${dir}/tool`, `tool_api__${tool}`);
fs.writeFileSync(`${dir}/args.json`, JSON.stringify(args));
NODE

bakers tools "$(cat "$work/tool")" --data @"$work/args.json" | tee "$work/result.json"

# A new ticket goes straight to the cw-framework conductor so it is worked on.
if [ "$(cat "$work/tool")" = tool_api__bakers_ticket_create ]; then
  node -e 'const fs = require("fs"); const { identifier } = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(JSON.stringify({ticket: identifier, conductor: "4081d638-37ef-4bc3-80cd-72501492e6b3"}))' \
    "$work/result.json" >"$work/assign.json"
  bakers tools tool_api__bakers_ticket_update --data @"$work/assign.json"
fi
