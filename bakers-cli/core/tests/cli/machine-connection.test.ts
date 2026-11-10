import { describe, expect, it } from 'vitest';
import { isValidMachineConnectionUrl } from '../../src/cli/machine-connection.js';

describe('machine connection URL', () => {
  it.each([
    'ssh://christian@192.168.1.20:22', 'ssh://user%2Dname@[::1]:2222/',
    'ssh://host', 'https://example.com/path?q=value#section',
    'https://[2001:db8::1]:443/',
  ])('accepts public connection address %s', (url) => {
    expect(isValidMachineConnectionUrl(url)).toBe(true);
  });
  it.each([
    undefined, null, 22, '', '/relative', 'http://example.com', 'javascript:alert(1)',
    'ssh://user:pass@host', 'https://user@host', 'ssh://host/path',
    'ssh://host?secret=1', 'ssh://host#x', 'ssh://host:0', 'ssh://host:65536',
    'ssh://host:', 'ssh://host:abc', 'ssh://bad_host', 'ssh://-bad.host',
    'ssh://999.1.1.1', 'ssh://[bad]', 'ssh://user%zz@host',
    'ssh://user%00@host', 'ssh://user%20name@host', 'ssh://host\n',
    'https://example.com/white space', 'https://example.com/%zz',
    'https://example.com\\@evil.test', `https://example.com/${'a'.repeat(2048)}`,
  ])('rejects unsafe or malformed input %s', (url) => {
    expect(isValidMachineConnectionUrl(url)).toBe(false);
  });
});
