import { describe, expect, it } from 'vitest';
import { basicAuthProvider } from '../src/index.js';

describe('basicAuthProvider', () => {
  it('exposes id + authProvider', () => {
    const p = basicAuthProvider('dG9rZW4=');
    expect(p.id).toBe('bakers-basic-auth');
    expect(p.authProvider).toBeDefined();
  });
  it('adds Authorization: Basic, preserving headers', async () => {
    const a = (
      basicAuthProvider('dG9rZW4=').authProvider as any
    ).createAdapter();
    const out = await a.apply({ headers: { 'X-Keep': '1' } });
    expect(out.headers.Authorization).toBe('Basic dG9rZW4=');
    expect(out.headers['X-Keep']).toBe('1');
  });
  it('works with no headers', async () => {
    const a = (
      basicAuthProvider('dG9rZW4=').authProvider as any
    ).createAdapter();
    expect((await a.apply({})).headers.Authorization).toBe('Basic dG9rZW4=');
  });
  it('status loggedIn without network', async () => {
    const s = await (basicAuthProvider('x').authProvider as any).status();
    expect(s).toEqual({ loggedIn: true, provider: 'basic_auth' });
  });
});
