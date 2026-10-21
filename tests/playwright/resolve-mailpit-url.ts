/**
 * Resolve the Mailpit API base URL for the running suite (BB-430).
 *
 * Shaped after `resolve-base-url.ts` and for the same reason: no caller should
 * have to pass a URL. Precedence:
 *
 *   1. an explicit `MAILPIT_BASE_URL` in the environment (ad-hoc override);
 *   2. `http://localhost:8025` when `DDEV_PRIMARY_URL` is set — i.e. inside the
 *      DDEV web container, which is where CI runs the suite and where Mailpit
 *      listens on the container's own port 8025;
 *   3. derived from the site's base URL as `<host>:8026`, DDEV's router port
 *      for Mailpit, for a developer running the suite from the host.
 *
 * WHY THE MAIL IS READ OVER HTTP AT ALL, rather than generating the link with
 * Drush: the assertion is that a mail was SENT. `user_pass_reset_url()` would
 * produce a working link without any mail existing, so a Drush shortcut would
 * prove the landing and quietly stop proving the mail — which is the half of
 * AC-2 a customer actually experiences.
 */
export function resolveMailpitURLFrom(env: NodeJS.ProcessEnv, baseURL: string): string {
    if (env.MAILPIT_BASE_URL) {
        return env.MAILPIT_BASE_URL.replace(/\/$/, '');
    }
    if (env.DDEV_PRIMARY_URL) {
        return 'http://localhost:8025';
    }
    const url = new URL(baseURL);
    url.port = '8026';
    url.pathname = '';
    return url.toString().replace(/\/$/, '');
}
