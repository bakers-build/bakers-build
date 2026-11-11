import { isIP } from 'node:net';

/** Public connection addresses only; preserve the original spelling for copy. */
export function isValidMachineConnectionUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    // Printable ASCII only: the server applies the same rule, and link text cannot be spoofed.
    /[^\x21-\x7e]|\\/.test(value)
  )
    return false;
  const parts = /^(ssh|https):\/\/([^/?#]+)(.*)$/i.exec(value);
  if (!parts) return false;
  try {
    // U+180E: PCRE's \s on the server covers it, JavaScript's does not.
    if (/[\s\p{Cc}\u180e]/u.test(decodeURIComponent(value))) return false;
    const [, scheme = '', authority = '', tail] = parts;
    const ssh = scheme.toLowerCase() === 'ssh';
    if (ssh && tail !== '' && tail !== '/') return false;
    const hostPart = authority.split('@');
    if (hostPart.length > 2 || (!ssh && hostPart.length > 1)) return false;
    if (
      hostPart.length === 2 &&
      (!hostPart[0] || /[:/?#@]/.test(decodeURIComponent(hostPart[0])))
    )
      return false;
    const hostPort = hostPart.at(-1) ?? '';
    const match = /^(\[[^\]]+\]|[^:]+)(?::([0-9]+))?$/.exec(hostPort);
    if (!match) return false;
    const [, host = '', port] = match;
    if (port !== undefined && (Number(port) < 1 || Number(port) > 65535))
      return false;
    // isIP accepts zone IDs (fe80::1%eth0); the server does not.
    if (host.startsWith('['))
      return !host.includes('%') && isIP(host.slice(1, -1)) === 6;
    if (/^[0-9.]+$/.test(host)) return isIP(host) === 4;
    return (
      host.length <= 253 &&
      host
        .replace(/\.$/, '')
        .split('.')
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    );
  } catch {
    return false;
  }
}
