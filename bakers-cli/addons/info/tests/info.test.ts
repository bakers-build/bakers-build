import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadReadyBbConnection = vi.fn();
const createBbConnectionClient = vi.fn();
const discoverBbWorkspaces = vi.fn();
const resolveConfigPath = vi.fn(() => '/fake/.bakers/conductor.config.js');
const readBbProjectSelection = vi.fn();
const resolveBbProjectContext = vi.fn();

vi.mock('@bakers-build/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bakers-build/core')>();
  return {
    ...actual,
    loadReadyBbConnection,
    createBbConnectionClient,
    discoverBbWorkspaces,
    resolveConfigPath,
  };
});
vi.mock('@bakers-build/conductor/project-context', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@bakers-build/conductor/project-context')>();
  return { ...actual, readBbProjectSelection };
});
vi.mock('@bakers-build/conductor/contract', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@bakers-build/conductor/contract')>();
  return { ...actual, resolveBbProjectContext };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual };
});

const { resolveBbInfo } = await import('../src/info.js');

const host = { resolveBases: [] };

beforeEach(() => {
  loadReadyBbConnection.mockReset();
  createBbConnectionClient.mockReset();
  discoverBbWorkspaces.mockReset();
  resolveConfigPath
    .mockReset()
    .mockReturnValue('/fake/.bakers/conductor.config.js');
  readBbProjectSelection.mockReset();
  resolveBbProjectContext.mockReset();
});

function fakeResource(id: string, attrs: Record<string, unknown> = {}) {
  return {
    id,
    type: 'fake',
    attr: (key: string) => attrs[key],
    rel: () => null,
    rels: () => [],
    raw: { id, type: 'fake', attributes: attrs },
  };
}

describe('resolveBbInfo (BB-495)', () => {
  it('prints the five context values as JSON and writes nothing — reads env first', async () => {
    const env = {
      BB_PROJECT: 'demo',
      BB_PROJECT_ID: 'proj-uuid',
      BB_WORKSPACE: 'Acme',
      BB_WORKSPACE_ID: 'ws-uuid',
      BB_WORKSPACE_IDS: 'ws-uuid,ws-2',
    };
    const result = await resolveBbInfo({ host, env });
    expect(Object.keys(result).sort()).toEqual(
      [
        'project',
        'project_id',
        'workspace',
        'workspace_id',
        'workspace_ids',
      ].sort(),
    );
    expect(Array.isArray(result.workspace_ids)).toBe(true);
    expect(result).toEqual({
      project: 'demo',
      project_id: 'proj-uuid',
      workspace: 'Acme',
      workspace_id: 'ws-uuid',
      workspace_ids: ['ws-uuid', 'ws-2'],
    });
    expect(loadReadyBbConnection).not.toHaveBeenCalled();
  });

  it('resolves workspace fields live when the env carries none', async () => {
    loadReadyBbConnection.mockResolvedValueOnce({
      workspace_id: 'ws-uuid',
      plugins: [],
      site: { base_url: 'https://x.test', jsonapi_prefix: '/jsonapi' },
    });
    createBbConnectionClient.mockResolvedValueOnce({
      resource: async () => fakeResource('ws-uuid', { name: 'Acme' }),
      collection: () => ({
        where: () => ({ first: async () => null }),
      }),
    });
    discoverBbWorkspaces.mockResolvedValueOnce([
      { id: 'ws-uuid', name: 'Acme' },
      { id: 'ws-2', name: 'Other' },
    ]);
    const result = await resolveBbInfo({ host, env: {} });
    expect(result.workspace).toBe('Acme');
    expect(result.workspace_id).toBe('ws-uuid');
    expect(result.workspace_ids).toEqual(['ws-uuid', 'ws-2']);
    expect(result.project).toBeNull();
    expect(result.project_id).toBeNull();
  });

  it('resolves project_id by name once the project name is known', async () => {
    loadReadyBbConnection.mockResolvedValueOnce({
      workspace_id: undefined,
      plugins: [],
      site: { base_url: 'https://x.test', jsonapi_prefix: '/jsonapi' },
    });
    discoverBbWorkspaces.mockResolvedValueOnce([]);
    readBbProjectSelection.mockReturnValueOnce({ project: 'demo' });
    resolveBbProjectContext.mockResolvedValueOnce({
      projectId: 'proj-uuid',
      project: 'demo',
      workspaceId: 'ws-uuid',
      workspace: 'Engineering',
    });
    createBbConnectionClient.mockResolvedValueOnce({
      collection: () => ({
        where: () => ({
          page: () => ({
            list: async () => [fakeResource('proj-uuid', { name: 'demo' })],
          }),
        }),
      }),
    });

    const result = await resolveBbInfo({ host, env: {} });
    expect(result.project).toBe('demo');
    expect(result.project_id).toBe('proj-uuid');
  });

  it('uses committed bakers.workspace to scope the one live connection and project lookup', async () => {
    readBbProjectSelection.mockReturnValueOnce({
      project: 'demo',
      workspace: 'Engineering',
    });
    resolveBbProjectContext.mockResolvedValueOnce({
      projectId: 'proj-uuid',
      project: 'demo',
      workspaceId: 'ws-uuid',
      workspace: 'Engineering',
    });
    loadReadyBbConnection.mockResolvedValueOnce({
      workspace_id: 'ws-uuid',
      plugins: [{ id: 'bakers-workspace' }],
      site: { base_url: 'https://x.test', jsonapi_prefix: '/jsonapi' },
    });
    discoverBbWorkspaces.mockResolvedValueOnce([
      { id: 'ws-uuid', name: 'Engineering' },
    ]);
    createBbConnectionClient.mockResolvedValueOnce({
      collection: () => ({
        where: () => ({ page: () => ({ list: async () => [] }) }),
      }),
    });

    const result = await resolveBbInfo({ host, env: {} });

    expect(loadReadyBbConnection).toHaveBeenCalledTimes(1);
    expect(loadReadyBbConnection).toHaveBeenCalledWith(
      host,
      expect.objectContaining({ workspaceSelector: 'Engineering' }),
    );
    expect(resolveBbProjectContext).toHaveBeenCalledWith(expect.anything(), {
      project: 'demo',
      workspace: 'Engineering',
    });
    expect(result).toMatchObject({
      project: 'demo',
      project_id: 'proj-uuid',
      workspace: 'Engineering',
      workspace_id: 'ws-uuid',
    });
  });

  it('surfaces project ambiguity when the committed workspace is omitted', async () => {
    readBbProjectSelection.mockReturnValueOnce({ project: 'demo' });
    loadReadyBbConnection.mockResolvedValue({
      workspace_id: undefined,
      plugins: [],
      site: { base_url: 'https://x.test', jsonapi_prefix: '/jsonapi' },
    });
    discoverBbWorkspaces.mockResolvedValue([]);
    createBbConnectionClient.mockResolvedValue({});
    resolveBbProjectContext.mockRejectedValue(
      new Error(
        'Ambiguous project demo: Engineering, Sales. Commit bakers.workspace.',
      ),
    );
    await expect(resolveBbInfo({ host, env: {} })).rejects.toThrow(
      /Engineering, Sales.*bakers\.workspace/,
    );
  });

  // A person who has just run `bakers init` has a machine and a connection and
  // no project layer at all — that is the whole point of running it outside a
  // checkout. The rank read has to answer for them too, or "signed in" and
  // "signed in and holding nothing" stay indistinguishable.
  it('reports workspaces outside a checkout, where no conductor config exists', async () => {
    resolveConfigPath.mockImplementation(() => {
      throw Object.assign(
        new Error('no .bakers/conductor.config.js found from /tmp/x upward'),
        { code: 'ENOENT' },
      );
    });
    loadReadyBbConnection.mockResolvedValueOnce({
      workspace_id: undefined,
      plugins: [],
      site: { base_url: 'https://x.test', jsonapi_prefix: '/jsonapi' },
    });
    discoverBbWorkspaces.mockResolvedValueOnce([
      { id: 'ws-uuid', name: 'Acme' },
    ]);

    const result = await resolveBbInfo({ host, env: {} });

    expect(result.workspace_ids).toEqual(['ws-uuid']);
    expect(result.project).toBeNull();
    expect(result.project_id).toBeNull();
  });

  it('leaves every key null/empty, never throwing, when nothing resolves', async () => {
    loadReadyBbConnection.mockRejectedValue(
      new Error('no connection config'),
    );
    const result = await resolveBbInfo({ host, env: {} });
    expect(result).toEqual({
      project: null,
      project_id: null,
      workspace: null,
      workspace_id: null,
      workspace_ids: [],
    });
  });

  // BB-495 F2: the whole point of `bakers info` over the interactive recovery
  // it replaces is that it READS rather than PROMPTS-AND-WRITES. A spy on the
  // real `node:fs` write surface — not a hand-declared array nobody feeds —
  // is what makes "writes nothing" falsifiable rather than trivially true.
  describe('writes nothing to disk', () => {
    let writeFileSync: ReturnType<typeof vi.spyOn>;
    let appendFileSync: ReturnType<typeof vi.spyOn>;
    let writeFile: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      writeFileSync = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined);
      appendFileSync = vi
        .spyOn(fs, 'appendFileSync')
        .mockImplementation(() => undefined);
      writeFile = vi
        .spyOn(fsPromises, 'writeFile')
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      writeFileSync.mockRestore();
      appendFileSync.mockRestore();
      writeFile.mockRestore();
    });

    it('on the catch path (nothing resolves)', async () => {
      loadReadyBbConnection.mockRejectedValue(
        new Error('no connection config'),
      );
      await resolveBbInfo({ host, env: {} });

      expect(writeFileSync).not.toHaveBeenCalled();
      expect(appendFileSync).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('on the live-resolution success path', async () => {
      loadReadyBbConnection.mockResolvedValueOnce({
        workspace_id: 'ws-uuid',
        plugins: [],
        site: { base_url: 'https://x.test', jsonapi_prefix: '/jsonapi' },
      });
      createBbConnectionClient.mockResolvedValueOnce({
        resource: async () => fakeResource('ws-uuid', { name: 'Acme' }),
        collection: () => ({
          where: () => ({ first: async () => null }),
        }),
      });
      discoverBbWorkspaces.mockResolvedValueOnce([
        { id: 'ws-uuid', name: 'Acme' },
        { id: 'ws-2', name: 'Other' },
      ]);
      const result = await resolveBbInfo({ host, env: {} });

      expect(result.workspace_id).toBe('ws-uuid');
      expect(writeFileSync).not.toHaveBeenCalled();
      expect(appendFileSync).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });
  });
});
