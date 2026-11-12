import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import type { HookListener } from '@bakers-build/conductor/contract';
import { isValidMachineConnectionUrl } from '@bakers-build/core';

export interface TailscaleOptions {
  ssh_user: string;
  ssh_port?: number;
}

export function tailscaleHook(options: TailscaleOptions): HookListener {
  const port = options?.ssh_port ?? 22;
  if (
    typeof options?.ssh_user !== 'string' ||
    !options.ssh_user ||
    /[\s\p{Cc}:/?#@\\]/u.test(options.ssh_user) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      'Tailscale requires a valid ssh_user and SSH port (1–65535)',
    );
  }
  const user = encodeURIComponent(options.ssh_user);
  return {
    id: 'tailscale',
    async before_conductor_start(machine) {
      if (machine.connection_url !== undefined) return;
      const address = await new Promise<string | undefined>((resolve) => {
        execFile(
          'tailscale',
          ['ip', '-4'],
          { encoding: 'utf8', timeout: 3000, maxBuffer: 4096 },
          (error, stdout) => {
            if (error) {
              console.warn('tailscale: discovery_failed');
              resolve(undefined);
              return;
            }
            const ip = stdout.trim();
            if (isIP(ip) !== 4) {
              console.warn('tailscale: invalid_address');
              resolve(undefined);
              return;
            }
            resolve(ip);
          },
        );
      });
      if (address === undefined) return;
      const url = `ssh://${user}@${address}:${port}`;
      if (isValidMachineConnectionUrl(url)) machine.connection_url = url;
      else console.warn('tailscale: invalid_url');
    },
  };
}
