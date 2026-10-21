import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

export function conductorId(absPath: string): string {
  return createHash('sha256')
    .update(`${hostname()}:${absPath}`)
    .digest('hex')
    .slice(0, 16);
}
