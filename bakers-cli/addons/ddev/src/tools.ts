// The ddev addon's agent tools, served by the conductor on the worktree bound
// to the run. Every call runs in the worktree and first checks that DDEV
// resolves the worktree's own project: an unregistered worktree makes DDEV fall
// back to the registered parent checkout, whose containers no run may touch.
// Typed structurally against the conductor's tool contract, so this addon
// needs no conductor dependency.

import { spawn } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import {
  type DdevContainer,
  ddevProtectedPaths,
  ddevProtectionCompose,
  protectedDdevWeb,
} from './protection.js';

/** Output beyond this many characters is cut from the front. */
export const OUTPUT_CAP = 64 * 1024;
const START_TIMEOUT_MS = 10 * 60_000;
const TIMEOUT_MS = 5 * 60_000;

export type DdevRun = (
  args: string[],
  opts: { cwd: string; timeoutMs: number; signal: AbortSignal },
) => Promise<{ exitCode: number; output: string }>;

export interface Request {
  worktreePath: string;
  protectedPaths?: readonly string[];
  args: Record<string, unknown>;
  signal: AbortSignal;
}
export type Handler = (req: Request) => Promise<{ text: string }>;

const tail = (s: string) => (s.length > OUTPUT_CAP ? s.slice(-OUTPUT_CAP) : s);
const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** `ddev` with stdout and stderr interleaved, killed at the timeout. */
const commandRun =
  (command: string): DdevRun =>
  (args, { cwd, timeoutMs, signal }) =>
    new Promise((done, fail) => {
      const child = spawn(command, args, {
        cwd,
        signal,
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      const collect = (chunk: Buffer) => {
        output = tail(output + chunk.toString('utf8'));
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', fail);
      child.on('close', (code, sig) =>
        done({
          exitCode: code ?? 124,
          output: sig ? `${output}\n(killed: ${sig})` : output,
        }),
      );
    });
export const nodeDdevRun = commandRun('ddev');
const nodeDockerRun = commandRun('docker');

function ddevOperations(run: DdevRun, docker: DdevRun) {
  const dockerCall = async (req: Request, args: string[]) => {
    const result = await docker(args, {
      cwd: req.worktreePath,
      timeoutMs: TIMEOUT_MS,
      signal: req.signal,
    });
    if (result.exitCode)
      throw new Error(
        `DDEV protection: docker exit ${result.exitCode}\n${tail(result.output)}`,
      );
    return result.output;
  };
  const checkVolumes = async (req: Request, names: string[]) => {
    if (!names.length) return;
    const volumes = JSON.parse(
      await dockerCall(req, ['volume', 'inspect', ...new Set(names)]),
    ) as { Driver: string; Options?: Record<string, unknown> | null }[];
    if (
      !Array.isArray(volumes) ||
      volumes.length !== new Set(names).size ||
      volumes.some(
        (volume) =>
          volume.Driver !== 'local' || Object.keys(volume.Options ?? {}).length,
      )
    )
      throw new Error(
        'DDEV protection: custom volume drivers and options are unsupported',
      );
  };
  const checkedWeb = async (
    req: Request,
    project: string,
    paths: readonly string[],
  ) => {
    const ids = (
      await dockerCall(req, [
        'ps',
        '-aq',
        '--filter',
        `label=com.ddev.site-name=${project}`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!ids.length)
      throw new Error(
        'DDEV protection: project containers missing; call ddev_start',
      );
    const containers = JSON.parse(
      await dockerCall(req, ['inspect', ...ids]),
    ) as DdevContainer[];
    const volumes = containers.flatMap((container) =>
      container.Mounts.filter((mount) => mount.Type === 'volume').map(
        (mount) => {
          if (!mount.Name)
            throw new Error('DDEV protection: unresolved volume name');
          return mount.Name;
        },
      ),
    );
    await checkVolumes(req, volumes);
    return protectedDdevWeb(containers, project, req.worktreePath, paths);
  };
  const ddev = async (req: Request, args: string[], timeoutMs = TIMEOUT_MS) => {
    const { exitCode, output } = await run(args, {
      cwd: req.worktreePath,
      timeoutMs,
      signal: req.signal,
    });
    const text = `exit ${exitCode}\n${tail(output)}`;
    if (exitCode !== 0) throw new Error(text);
    return { exitCode, output, text };
  };
  /** The described project, refused unless its approot is the worktree. */
  const ownProject = async (req: Request) => {
    const { output } = await ddev(req, ['describe', '-j']);
    let raw: Record<string, unknown> | undefined;
    try {
      raw = JSON.parse(output.trim().split('\n').pop() ?? '').raw;
    } catch {}
    const approot = typeof raw?.approot === 'string' ? raw.approot : undefined;
    if (!raw || !approot || real(approot) !== real(req.worktreePath)) {
      throw new Error(
        `DDEV resolves the project at ${approot ?? '(unknown)'}, not this worktree (${req.worktreePath}); run bash .bakers/scripts/worktree-post.sh in the worktree to register it.\n${tail(output)}`,
      );
    }
    return raw;
  };
  const prepare = async (req: Request) => {
    if (req.protectedPaths === undefined) return;
    const raw = await ownProject(req);
    const file = join(
      req.worktreePath,
      '.ddev',
      'docker-compose.bakers-protection.yaml',
    );
    // Stop existing writers before replacing their mount policy or reading launch files.
    const ids = (
      await dockerCall(req, [
        'ps',
        '-q',
        '--filter',
        `label=com.ddev.site-name=${String(raw.name)}`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length) await dockerCall(req, ['stop', ...ids]);
    const paths = ddevProtectedPaths(req.worktreePath, req.protectedPaths);
    const previous = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    rmSync(file, { force: true });
    try {
      const composed = (await ddev(req, ['utility', 'compose-config'])).output;
      const config = parse(composed) as {
        volumes?: Record<string, { name?: string }>;
      };
      const names = Object.values(config.volumes ?? {}).map((volume) => {
        if (!volume.name)
          throw new Error('DDEV protection: unresolved volume name');
        return volume.name;
      });
      if (names.length) {
        const existing = new Set(
          (await dockerCall(req, ['volume', 'ls', '--format', '{{.Name}}']))
            .trim()
            .split(/\s+/),
        );
        await checkVolumes(
          req,
          names.filter((name) => existing.has(name)),
        );
      }
      writeFileSync(
        `${file}.tmp`,
        ddevProtectionCompose(composed, paths, req.worktreePath),
      );
      renameSync(`${file}.tmp`, file);
    } catch (error) {
      if (previous !== undefined) writeFileSync(file, previous);
      throw error;
    } finally {
      rmSync(`${file}.tmp`, { force: true });
    }
    if (ids.length) {
      await ddev(req, ['start'], START_TIMEOUT_MS);
      await checkedWeb(req, String(raw.name), paths);
    }
  };
  const tools: Record<string, Handler> = {
    ddev_status: async (req) => {
      const raw = await ownProject(req);
      return {
        text: JSON.stringify({
          name: raw.name,
          status: raw.status,
          primary_url: raw.primary_url,
          services: Object.fromEntries(
            Object.entries(
              (raw.services ?? {}) as Record<string, { status?: string }>,
            ).map(([name, s]) => [name, s.status]),
          ),
        }),
      };
    },
    ddev_start: async (req) => {
      const raw = await ownProject(req);
      if (req.protectedPaths === undefined)
        return { text: (await ddev(req, ['start'], START_TIMEOUT_MS)).text };
      await prepare(req);
      const paths = ddevProtectedPaths(req.worktreePath, req.protectedPaths);
      const result = await ddev(req, ['start'], START_TIMEOUT_MS);
      await checkedWeb(req, String(raw.name), paths);
      return { text: result.text };
    },
    ddev_exec: async (req) => {
      const raw = await ownProject(req);
      if (req.protectedPaths !== undefined) {
        const paths = ddevProtectedPaths(req.worktreePath, req.protectedPaths);
        const id = await checkedWeb(req, String(raw.name), paths);
        // Pin the inspected ID so a concurrent recreation cannot switch the execution target.
        const result = await docker(
          [
            'exec',
            '--workdir',
            '/var/www/html',
            id,
            'bash',
            '-c',
            String(req.args.command),
          ],
          { cwd: req.worktreePath, timeoutMs: TIMEOUT_MS, signal: req.signal },
        );
        const text = `exit ${result.exitCode}\n${tail(result.output)}`;
        if (result.exitCode) throw new Error(text);
        return { text };
      }
      return {
        text: (await ddev(req, ['exec', String(req.args.command)])).text,
      };
    },
  };
  return { tools, prepare };
}

export function ddevTools(
  run: DdevRun,
  docker: DdevRun = nodeDockerRun,
): Record<string, Handler> {
  return ddevOperations(run, docker).tools;
}

export async function prepareDdevProtection(binding: {
  worktreePath: string;
  protectedPaths?: readonly string[];
}) {
  if (binding.protectedPaths === undefined) return;
  await ddevOperations(nodeDdevRun, nodeDockerRun).prepare({
    ...binding,
    args: {},
    signal: new AbortController().signal,
  });
}
