import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';

/** The login's expiry; an unreadable file counts as oldest. */
function expiry(file: string): number {
  try {
    return (
      Number(JSON.parse(readFileSync(file, 'utf8')).claudeAiOauth?.expiresAt) ||
      0
    );
  } catch {
    return 0;
  }
}

/**
 * Point `path` at the single host login `host` again. Claude Code refreshes by
 * renaming a new file over `path`, which replaces a symlink with a private copy;
 * a copy newer than the host's login becomes the host's before it is relinked.
 */
export function shareLogin(host: string, path: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink() && readlinkSync(path) === host) return;
  if (stat?.isFile() && (!existsSync(host) || expiry(path) > expiry(host)))
    // In place, not by rename: runs bind-mount the host file's inode.
    writeFileSync(host, readFileSync(path), { mode: 0o600 });
  if (!existsSync(host))
    throw new Error(
      `claude: no usable login at ${host}; log in on the host with \`claude /login\``,
    );
  const link = `${path}.${process.pid}.link`;
  rmSync(link, { force: true });
  symlinkSync(host, link);
  renameSync(link, path);
}
