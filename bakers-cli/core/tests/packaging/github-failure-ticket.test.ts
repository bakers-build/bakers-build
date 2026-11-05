import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = new URL(
  '../../../../scripts/ci/github-failure-ticket.sh',
  import.meta.url,
).pathname;
const TITLE = 'CI failure: scheduled GitHub checks on next';

type Call = { tool: string; args: Record<string, string> };

// Runs the script against a stub `bakers` that records each tool call and answers a search
// with the given tickets.
function report(
  tickets: Array<{ identifier: string; title: string; state: string }>,
) {
  const dir = mkdtempSync(join(tmpdir(), 'github-failure-ticket-'));
  try {
    writeFileSync(join(dir, 'search.json'), JSON.stringify({ tickets }));
    writeFileSync(
      join(dir, 'bakers'),
      `#!/bin/bash
data="$4"; data="\${data#@}"
node -e 'const fs=require("fs");fs.appendFileSync(process.env.CALLS,JSON.stringify({tool:process.argv[1],args:JSON.parse(fs.readFileSync(process.argv[2],"utf8"))})+"\\n")' "$2" "$data"
case "$2" in
  *ticket_search) cat "$SEARCH" ;;
  *ticket_create) echo '{"id":"u","identifier":"BAKERS-999","state":"qualification"}' ;;
  *) echo '{"id":"c","type":"comment"}' ;;
esac
`,
      { mode: 0o755 },
    );
    const result = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CALLS: join(dir, 'calls'),
        SEARCH: join(dir, 'search.json'),
        FAILED_JOBS: 'image_gate, phpcs',
        GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
        RUN_URL: 'https://github.com/bakers-build/bakers-build/actions/runs/42',
      },
    });
    let calls: Call[] = [];
    try {
      calls = readFileSync(join(dir, 'calls'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    } catch {}
    return { status: result.status, stderr: result.stderr, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tools = (calls: Call[]) =>
  calls.map((call) => call.tool.replace('tool_api__', ''));
const namesTheFailure = (text: string) => {
  expect(text).toContain('image_gate, phpcs');
  expect(text).toContain('0123456789abcdef0123456789abcdef01234567');
  expect(text).toContain(
    'https://github.com/bakers-build/bakers-build/actions/runs/42',
  );
};

describe('GitHub checks failure ticket', () => {
  it('creates one BAKERS bug when no CI-failure ticket is open', () => {
    const result = report([
      {
        identifier: 'BAKERS-7',
        title: 'CI failure handling docs',
        state: 'working',
      },
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(tools(result.calls)).toEqual([
      'bakers_ticket_search',
      'bakers_ticket_create',
    ]);
    expect(result.calls[0].args).toEqual({ query: TITLE, project: 'BAKERS' });
    const created = result.calls[1].args;
    expect(created).toMatchObject({
      title: TITLE,
      project: 'BAKERS',
      workflow: 'bb_work',
      type: 'bug',
    });
    namesTheFailure(created.description);
  });

  it('comments on the open CI-failure ticket instead of creating a duplicate', () => {
    const result = report([
      { identifier: 'BAKERS-90', title: TITLE, state: 'working' },
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(tools(result.calls)).toEqual([
      'bakers_ticket_search',
      'bakers_comment_publish',
    ]);
    expect(result.calls[1].args).toMatchObject({
      ticket: 'BAKERS-90',
      type: 'comment',
    });
    namesTheFailure(result.calls[1].args.body);
  });

  it('treats a done CI-failure ticket as closed and creates a new one', () => {
    const result = report([
      { identifier: 'BAKERS-80', title: TITLE, state: 'done' },
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(tools(result.calls)).toEqual([
      'bakers_ticket_search',
      'bakers_ticket_create',
    ]);
  });
});
