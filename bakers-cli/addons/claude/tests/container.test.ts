import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { claudeContainer } from '../src/container.js';
import { ClaudeAgent, encodeClaudeProjectDir } from '../src/index.js';

let root: string;
let agentHome: string;
let runHome: string;
let hostHome: string;
const ws = '/w/tree';
const key = encodeClaudeProjectDir(ws);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-claude-container-'));
  agentHome = join(root, 'agent');
  runHome = join(root, 'run');
  hostHome = join(root, 'home');
  mkdirSync(agentHome, { recursive: true });
  mkdirSync(runHome, { recursive: true });
  writeFileSync(join(agentHome, 'settings.json'), '{"s":1}');
  writeFileSync(join(agentHome, '.claude.json'), '{"c":1}');
  writeFileSync(join(agentHome, '.credentials.json'), '{"secret":1}');
});

const prepare = (env: Record<string, string>, keyPlaceholder?: string) =>
  claudeContainer.prepare({
    runHome,
    containerHome: '/home/run',
    workspacePath: ws,
    env,
    hostHome,
    ...(keyPlaceholder ? { keyPlaceholder } : {}),
  });

describe('claude container', () => {
  it('is what the Claude agent declares', () => {
    expect(new ClaudeAgent().container).toBe(claudeContainer);
  });

  it('copies the settings of the agent home, never its login', () => {
    prepare({ CLAUDE_CONFIG_DIR: agentHome });
    const dir = join(runHome, '.claude');
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe('{"s":1}');
    expect(existsSync(join(dir, '.credentials.json'))).toBe(false);
  });

  it('seeds a finished onboarding so Claude does not wait at first-run setup', () => {
    prepare({ CLAUDE_CONFIG_DIR: agentHome });
    expect(
      JSON.parse(readFileSync(join(runHome, '.claude/.claude.json'), 'utf8')),
    ).toEqual({ c: 1, hasCompletedOnboarding: true });
    prepare({});
    expect(
      JSON.parse(readFileSync(join(runHome, '.claude.json'), 'utf8')),
    ).toEqual({ hasCompletedOnboarding: true });
  });

  it('approves the placeholder key so Claude does not ask about it', () => {
    prepare({ CLAUDE_CONFIG_DIR: agentHome }, 'bb-runtime-placeholder');
    const state = JSON.parse(
      readFileSync(join(runHome, '.claude/.claude.json'), 'utf8'),
    );
    expect(state.customApiKeyResponses).toEqual({
      approved: ['bb-runtime-placeholder'.slice(-20)],
      rejected: [],
    });
  });

  it('mounts plugins read-only and the transcript directory, with the config dir moved', () => {
    const out = prepare({ CLAUDE_CONFIG_DIR: agentHome });
    expect(out.env).toEqual({ CLAUDE_CONFIG_DIR: '/home/run/.claude' });
    const plugins = join(agentHome, 'plugins');
    expect(out.mounts).toEqual([
      { host: plugins, container: plugins, readOnly: true },
      { host: plugins, container: '/home/run/.claude/plugins', readOnly: true },
      {
        host: join(agentHome, 'projects', key),
        container: `/home/run/.claude/projects/${key}`,
      },
    ]);
    // Mount points docker would otherwise create root-owned.
    expect(existsSync(join(runHome, '.claude/plugins'))).toBe(true);
    expect(existsSync(join(runHome, '.claude/projects', key))).toBe(true);
    expect(existsSync(join(agentHome, 'projects', key))).toBe(true);
  });

  it("uses the operator's ~/.claude transcripts without an agent home", () => {
    const out = prepare({});
    expect(out.env).toEqual({});
    expect(out.mounts).toEqual([
      {
        host: join(hostHome, '.claude/projects', key),
        container: `/home/run/.claude/projects/${key}`,
      },
    ]);
  });

  it('prefers the OAuth token and sends each credential its own way', () => {
    const { auth } = claudeContainer.api;
    expect(Object.keys(auth)).toEqual([
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_API_KEY',
    ]);
    expect(auth.CLAUDE_CODE_OAUTH_TOKEN).toEqual({
      set: { authorization: 'Bearer {value}' },
      append: { 'anthropic-beta': 'oauth-2025-04-20' },
    });
    expect(auth.ANTHROPIC_API_KEY).toEqual({
      set: { 'x-api-key': '{value}' },
    });
    expect(claudeContainer.credentialHint).toMatch(/claude setup-token/);
  });
});
