import type { Command } from 'commander';
import type { CommandContext } from 'dropsh';
import { AuthError, exitCodeFor } from 'dropsh/plugin';

export interface AuthTokenDeps {
  contextFactory: () => Promise<CommandContext>;
  stdout(text: string): void;
  stderr(text: string): void;
  setExitCode(code: number): void;
}

/** The `exp` claim of a JWT access token as an ISO 8601 instant. */
function expiresAt(token: string): string {
  let exp: unknown;
  try {
    exp = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    ).exp;
  } catch {}
  if (typeof exp !== 'number')
    throw new AuthError('access token carries no expiry');
  return new Date(exp * 1000).toISOString();
}

/**
 * `auth token`: the profile's adapter refreshes inside its own margin and stores
 * the rotation; this prints only the resulting access token, never a refresh token.
 */
export function registerAuthTokenCommand(
  program: Command,
  deps: AuthTokenDeps,
): void {
  program.commands
    .find((entry) => entry.name() === 'auth')
    ?.command('token')
    .description(
      'Print a short-lived access token as JSON for direct API calls',
    )
    .action(async () => {
      try {
        const ctx = await deps.contextFactory();
        const request = await ctx.auth.apply({
          method: 'GET',
          url: ctx.baseUrl,
          headers: {},
        });
        const header = Object.entries(request.headers ?? {}).find(
          ([name]) => name.toLowerCase() === 'authorization',
        )?.[1];
        const token = /^Bearer (\S+)$/.exec(header ?? '')?.[1];
        if (!token)
          throw new AuthError('auth profile does not issue a bearer token');
        deps.stdout(
          `${JSON.stringify({
            base_url: ctx.baseUrl,
            token,
            token_type: 'Bearer',
            expires_at: expiresAt(token),
          })}\n`,
        );
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        let message = (
          error instanceof Error ? error.message : String(error)
        ).replaceAll('dropsh auth login', 'bakers auth login');
        // A rejected refresh says why, not what to do; every auth failure names the fix.
        if (code === 'E_AUTH' && !message.includes('bakers auth login'))
          message += " Run 'bakers auth login'.";
        // No `details`: AuthError details carry client ids and token endpoints.
        deps.stderr(
          `${JSON.stringify({
            error: {
              code:
                typeof code === 'string' && code.startsWith('E_')
                  ? code
                  : 'E_UNKNOWN',
              message,
            },
          })}\n`,
        );
        deps.setExitCode(exitCodeFor(error));
      }
    });
}
