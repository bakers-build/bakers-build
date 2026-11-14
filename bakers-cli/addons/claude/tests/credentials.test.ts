import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { shareLogin } from '../src/credentials.js';

const login = (expiresAt: number) =>
  JSON.stringify({
    claudeAiOauth: { accessToken: `a${expiresAt}`, expiresAt },
  });

let root: string;
let host: string;
let copy: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-claude-login-'));
  host = join(root, 'host.json');
  copy = join(root, 'home.json');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('keeps a newer home copy as the host login, in place, then relinks', () => {
  writeFileSync(host, login(2000), { mode: 0o600 });
  const inode = statSync(host).ino;
  writeFileSync(copy, login(3000));
  shareLogin(host, copy);
  expect(readFileSync(host, 'utf8')).toBe(login(3000));
  // Runs mount the host file's inode; it must survive the repair.
  expect(statSync(host).ino).toBe(inode);
  expect(readlinkSync(copy)).toBe(host);
});

it('drops an older or unreadable home copy and relinks to the host login', () => {
  for (const stale of [login(1000), 'not json']) {
    writeFileSync(host, login(2000));
    rmSync(copy, { force: true });
    writeFileSync(copy, stale);
    shareLogin(host, copy);
    expect(readFileSync(host, 'utf8')).toBe(login(2000));
    expect(readlinkSync(copy)).toBe(host);
  }
});

it('promotes the home copy when the host has no login file, with owner-only access', () => {
  writeFileSync(copy, login(3000));
  shareLogin(host, copy);
  expect(readFileSync(host, 'utf8')).toBe(login(3000));
  expect(statSync(host).mode & 0o777).toBe(0o600);
  expect(lstatSync(copy).isSymbolicLink()).toBe(true);
});

it('fails naming the fix when neither the host nor the home holds a login', () => {
  expect(() => shareLogin(host, copy)).toThrow(
    `claude: no usable login at ${host}; log in on the host with \`claude /login\``,
  );
});
