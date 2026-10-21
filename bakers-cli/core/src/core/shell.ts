/**
 * Quote a string as one POSIX shell argument: `'...'`, with each `'` written
 * as `'\''`. Newlines and other control bytes stay literal, which is legal
 * inside single quotes in every POSIX shell — dash included.
 *
 * Agent launch commands are no longer typed into an interactive pty: herdr
 * writes them to a file that `sh` evaluates (BB-635), so the bash/zsh-only
 * ANSI-C form (`$'...'`) the typed line once needed (BB-101) would corrupt
 * a multi-line prompt under dash, Debian's and Ubuntu's `/bin/sh`.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
