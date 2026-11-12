import { isAbsolute, relative, sep } from 'node:path';

/** The CLI build root for two package dirs; refuses one that would expose the operator home. */
export function cliRootOf(a: string, b: string, home: string): string {
  const x = a.split(sep);
  const y = b.split(sep);
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  let cliRoot = x.slice(0, i).join(sep) || sep;
  const nm = cliRoot.indexOf(`${sep}node_modules`);
  if (nm >= 0) cliRoot = cliRoot.slice(0, nm + `${sep}node_modules`.length);
  const rel = relative(cliRoot, home);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
    throw new Error(
      `runtime: the CLI build ${cliRoot} would mount ${home} into every run; install the CLI and its addons in one tree`,
    );
  return cliRoot;
}
