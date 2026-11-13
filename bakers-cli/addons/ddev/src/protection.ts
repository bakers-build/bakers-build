import { lstatSync, realpathSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { protectedProjectPaths } from '@bakers-build/core';
import { parse, stringify } from 'yaml';

const inside = (parent: string, child: string) =>
  parent === '/' || child === parent || child.startsWith(`${parent}/`);
const unsafeCaps = (caps?: string[]) =>
  caps?.some((cap) =>
    ['ALL', 'SYS_ADMIN', 'CAP_SYS_ADMIN'].includes(cap.toUpperCase()),
  );
const unsafeSocket = (source: string) =>
  lstatSync(source).isSocket() ||
  [
    '/run/docker.sock',
    '/var/run/docker.sock',
    ...(process.env.DOCKER_HOST?.startsWith('unix://')
      ? [process.env.DOCKER_HOST.slice(7)]
      : []),
  ].some((socket) => inside(source, socket));

/** Protect DDEV controls on both sides of the tool boundary and reject writable aliases. */
export function ddevProtectedPaths(
  worktree: string,
  paths: readonly string[],
): string[] {
  const root = realpathSync(worktree);
  if (!paths.includes(join(root, '.ddev')))
    throw new Error(
      'DDEV protection requires .ddev in runtime.read_only before granting tools',
    );
  const entries = paths.map((path) => {
    const entry = relative(root, path);
    if (entry.startsWith(`..${sep}`) || entry === '..' || !entry)
      throw new Error(`Invalid DDEV protected path: ${path}`);
    return entry;
  });
  return protectedProjectPaths(root, ['.ddev', '.git', ...entries]);
}

/** Add read-only overlays at every composed bind alias, including other services. */
export function ddevProtectionCompose(
  composed: string,
  paths: readonly string[],
  worktree: string,
): string {
  const config = parse(composed) as {
    volumes?: Record<
      string,
      { driver?: string; driver_opts?: Record<string, unknown> }
    >;
    services?: Record<
      string,
      {
        volumes?: unknown[];
        privileged?: boolean;
        cap_add?: string[];
        pid?: string;
        devices?: unknown[];
        volumes_from?: unknown[];
      }
    >;
  };
  if (!config?.services?.web)
    throw new Error('Cannot protect DDEV: resolved web service missing');
  if (
    Object.values(config.volumes ?? {}).some(
      (volume) =>
        volume &&
        ((volume.driver && volume.driver !== 'local') ||
          Object.keys(volume.driver_opts ?? {}).length),
    )
  )
    throw new Error(
      'DDEV protection: custom volume drivers and options are unsupported',
    );
  const services: Record<string, { volumes: object[] }> = {};
  for (const [name, service] of Object.entries(config.services)) {
    if (
      service.privileged ||
      service.pid === 'host' ||
      unsafeCaps(service.cap_add)
    )
      throw new Error('DDEV protection: unsafe container privileges');
    if (service.devices?.length || service.volumes_from?.length)
      throw new Error(
        'DDEV protection: devices and inherited volumes are unsupported',
      );
    const mounts = new Map<string, object>();
    for (const volume of service.volumes ?? []) {
      if (!volume || typeof volume !== 'object')
        throw new Error('Cannot protect DDEV: unresolved volume');
      const mount = volume as {
        type?: string;
        source?: string;
        target?: string;
        read_only?: boolean;
      };
      if (mount.type !== 'bind') continue;
      if (!mount.source?.startsWith('/') || !mount.target?.startsWith('/'))
        throw new Error('Cannot protect DDEV: unresolved bind mount');
      const source = realpathSync(mount.source);
      if (unsafeSocket(source))
        throw new Error('DDEV protection: host socket mount');
      if (!inside(realpathSync(worktree), source) && mount.read_only !== true)
        throw new Error('DDEV protection: writable host bind outside worktree');
      for (const path of paths) {
        const target = inside(source, path)
          ? posix.join(mount.target, relative(source, path))
          : inside(path, source)
            ? mount.target
            : undefined;
        if (target)
          mounts.set(target, {
            type: 'bind',
            source: inside(source, path) ? path : source,
            target,
            read_only: true,
            bind: { create_host_path: false },
          });
      }
    }
    if (mounts.size) services[name] = { volumes: [...mounts.values()] };
  }
  if (
    !config.services.web.volumes?.some((volume) => {
      const mount = volume as {
        type?: string;
        source?: string;
        target?: string;
      };
      return (
        mount.type === 'bind' &&
        mount.source &&
        realpathSync(mount.source) === realpathSync(worktree) &&
        mount.target === '/var/www/html'
      );
    })
  )
    throw new Error(
      'DDEV protection: a direct project bind at /var/www/html is required',
    );
  return stringify({ services });
}

export interface DdevContainer {
  Id: string;
  State: { Running: boolean };
  Config: { Labels: Record<string, string> };
  HostConfig: {
    Privileged?: boolean;
    CapAdd?: string[];
    PidMode?: string;
    Devices?: unknown[];
    VolumesFrom?: string[];
  };
  Mounts: {
    Type: string;
    Source: string;
    Destination: string;
    RW: boolean;
    Name?: string;
  }[];
}

/** Verify actual daemon mounts, not the generated YAML; return the inspected web ID. */
export function protectedDdevWeb(
  containers: DdevContainer[],
  project: string,
  worktree: string,
  paths: readonly string[],
): string {
  let web: string | undefined;
  if (!Array.isArray(containers) || !containers.length)
    throw new Error('DDEV protection: no project containers');
  for (const container of containers) {
    if (container.Config.Labels['com.ddev.site-name'] !== project)
      throw new Error('DDEV protection: unexpected project container');
    const host = container.HostConfig;
    if (
      host.Privileged ||
      host.PidMode === 'host' ||
      unsafeCaps(host.CapAdd) ||
      host.Devices?.length ||
      host.VolumesFrom?.length
    )
      throw new Error('DDEV protection: unsafe container privileges');
    const mounts = container.Mounts;
    for (const mount of mounts) {
      if (mount.Type !== 'bind') continue;
      const source = realpathSync(mount.Source);
      if (unsafeSocket(source))
        throw new Error('DDEV protection: host socket mount');
      if (!inside(realpathSync(worktree), source) && mount.RW)
        throw new Error('DDEV protection: writable host bind outside worktree');
      for (const path of paths) {
        if (inside(path, source) && mount.RW)
          throw new Error(`DDEV protection: writable alias of ${path}`);
        if (!inside(source, path)) continue;
        const target = posix.join(mount.Destination, relative(source, path));
        const effective = mounts
          .filter((candidate) => inside(candidate.Destination, target))
          .sort((a, b) => b.Destination.length - a.Destination.length)[0];
        if (!effective || effective.RW)
          throw new Error(
            `DDEV protection: ${path} is not read-only at ${target}; call ddev_start`,
          );
      }
    }
    if (container.Config.Labels['com.docker.compose.service'] === 'web') {
      if (
        web ||
        !container.State.Running ||
        !mounts.some(
          (mount) =>
            mount.Type === 'bind' &&
            realpathSync(mount.Source) === resolve(worktree) &&
            mount.Destination === '/var/www/html',
        )
      )
        throw new Error(
          'DDEV protection: expected one running web container with a direct project bind',
        );
      web = container.Id;
    }
  }
  if (!web) throw new Error('DDEV protection: running web container missing');
  return web;
}
