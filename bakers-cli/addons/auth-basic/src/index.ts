// BB-224 (Finding 6, decision 8): the inline HTTP Basic auth provider —
// formerly `@bakers-build/core`'s `plugins/auth/basic.ts` — now its own
// CONNECTION-surface addon. Name it in a `bakers.config.js` `addons: []` as
// `{ use: '@bakers-build/addon-auth-basic', with: { basic: '<base64>' } }`; it
// replaces the deleted `@bakers-build/core/builtins` `{ basic }` entry.
/**
 * Static HTTP Basic auth provider built from an inline base64 `user:pass` token
 * (conductor.config.local.js `auth.basic`, or the BB_E2E_BASIC env for tests).
 * Returns the `{ id, authProvider }` plugin shape that dropsh's resolveAuth reads
 * from `config.plugins`. Replaces the per-file basicAuthProvider that used to be
 * hand-written into each dropsh.config.js.
 */
export function basicAuthProvider(tokenBase64: string): {
  kind: 'auth';
  id: string;
  authProvider: unknown;
} {
  const authProvider = {
    id: 'basic_auth',
    displayName: 'HTTP Basic (inline)',
    capabilities: { login: false, logout: false, status: true },
    async login() {
      throw new Error('bakers.build uses static inline HTTP Basic auth.');
    },
    async logout() {},
    async status() {
      return { loggedIn: true, provider: 'basic_auth' };
    },
    createAdapter() {
      return {
        async apply(req: { headers?: Record<string, string> }) {
          return {
            ...req,
            headers: {
              ...(req.headers ?? {}),
              Authorization: `Basic ${tokenBase64}`,
            },
          };
        },
      };
    },
  };
  // BB-215: `.kind='auth'` makes the plugin tag total (every bakers.build plugin
  // self-identifies); dropsh ignores the extra field and reads `authProvider`.
  return { kind: 'auth', id: 'bakers-basic-auth', authProvider };
}

export default basicAuthProvider;
