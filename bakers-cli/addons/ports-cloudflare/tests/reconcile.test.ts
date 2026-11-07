import type { TunnelDesiredRecord } from '@bakers-build/addon-ports/transport';
import { describe, expect, it } from 'vitest';
import type { CfFetchResponse, CloudflareConfig } from '../src/cloudflare.js';
import { tunnelCnameTarget } from '../src/cloudflare.js';
import { reconcileCloudflare } from '../src/reconcile.js';

const IDENTITY: CloudflareConfig = {
  accountId: 'acc-1',
  tunnelId: 'tun-1',
  zoneId: 'zone-1',
  apiToken: 'secret',
};

function jsonResponse(status: number, body: unknown): CfFetchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A fake Cloudflare world shared by every test: an in-memory DNS record
 *  table and a counted ingress upload log — no real network. */
function fakeWorld(opts: { remoteIngress?: unknown[] } = {}) {
  const dns: Map<string, { id: string; content: string }> = new Map();
  let dnsSeq = 0;
  const uploads: { ingress: unknown }[] = [];
  let failNextUpload = false;
  let failNextCreate = false;
  let uncertainNextCreate = false;
  const remoteIngress = opts.remoteIngress ?? [];

  const deps = {
    timeoutMs: 1000,
    fetch: async (url: string, init: { method: string; body?: string }) => {
      if (url.includes('/configurations') && init.method === 'PUT') {
        if (failNextUpload) {
          failNextUpload = false;
          return jsonResponse(500, {
            success: false,
            errors: [{ message: 'upload failed' }],
          });
        }
        const body = JSON.parse(init.body as string);
        uploads.push({ ingress: body.config.ingress });
        return jsonResponse(200, { success: true, result: {} });
      }
      if (url.includes('/configurations') && init.method === 'GET') {
        return jsonResponse(200, {
          success: true,
          result: { config: { ingress: remoteIngress } },
        });
      }
      if (url.includes('/dns_records') && init.method === 'GET') {
        const nameMatch = /name=([^&]+)/.exec(url);
        const name = decodeURIComponent(nameMatch![1]!);
        const existing = dns.get(name);
        return jsonResponse(200, {
          success: true,
          result: existing
            ? [{ id: existing.id, content: existing.content }]
            : [],
        });
      }
      if (url.includes('/dns_records') && init.method === 'POST') {
        const body = JSON.parse(init.body as string);
        if (uncertainNextCreate) {
          uncertainNextCreate = false;
          // Simulate "request succeeded remotely but the response never
          // arrived" — create the record anyway, then fail the call.
          dnsSeq += 1;
          const id = `rec-${dnsSeq}`;
          dns.set(body.name, { id, content: body.content });
          return jsonResponse(500, {
            success: false,
            errors: [{ message: 'ambiguous timeout' }],
          });
        }
        if (failNextCreate) {
          failNextCreate = false;
          return jsonResponse(500, {
            success: false,
            errors: [{ message: 'dns create failed' }],
          });
        }
        dnsSeq += 1;
        const id = `rec-${dnsSeq}`;
        dns.set(body.name, { id, content: body.content });
        return jsonResponse(200, { success: true, result: { id } });
      }
      if (/\/dns_records\/rec-/.test(url) && init.method === 'DELETE') {
        const id = url.split('/').pop()!;
        for (const [name, rec] of dns) if (rec.id === id) dns.delete(name);
        return jsonResponse(200, { success: true, result: {} });
      }
      throw new Error(`unexpected fetch ${init.method} ${url}`);
    },
  };

  const checkpoints: (readonly TunnelDesiredRecord[])[] = [];
  const context = {
    checkpoint: async (records: readonly TunnelDesiredRecord[]) => {
      checkpoints.push(records);
    },
  };

  return {
    dns,
    uploads,
    deps,
    checkpoints,
    context,
    setFailNextUpload: () => (failNextUpload = true),
    setFailNextCreate: () => (failNextCreate = true),
    setUncertainNextCreate: () => (uncertainNextCreate = true),
  };
}

describe('reconcileCloudflare', () => {
  it('uploads the complete sorted ingress plus a final catch-all', async () => {
    const world = fakeWorld();
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'mailpit',
        hostname: 'a-1-mailpit.preview.example',
        service: 'http://127.0.0.1:8026',
        desired: 'present',
        applied: 'pending',
      },
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'drupal',
        hostname: 'a-1-drupal.preview.example',
        service: 'https://127.0.0.1:443',
        desired: 'present',
        applied: 'pending',
      },
    ];
    const result = await reconcileCloudflare(
      records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    expect(result.ok).toBe(true);
    expect(world.uploads).toHaveLength(1);
    const ingress = world.uploads[0]!.ingress as {
      hostname?: string;
      service: string;
    }[];
    expect(ingress.at(-1)).toEqual({ service: 'http_status:404' });
    expect(ingress.filter((r) => 'hostname' in r)).toHaveLength(2);
    expect(ingress[0]!.hostname).toBe('a-1-drupal.preview.example');
    expect(result.records.every((r) => r.applied === 'applied')).toBe(true);
    expect(result.records.every((r) => r.data?.dnsRecordId)).toBe(true);
    expect(result.records.every((r) => r.url?.startsWith('https://'))).toBe(
      true,
    );
    // DNS ownership was checkpointed before the whole reconcile finished.
    expect(world.checkpoints.length).toBeGreaterThan(0);
  });

  it('refuses to adopt an unmanaged exact-name DNS record', async () => {
    const world = fakeWorld();
    world.dns.set('a-1-drupal.preview.example', {
      id: 'foreign-1',
      content: 'somewhere-else.example',
    });
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'drupal',
        hostname: 'a-1-drupal.preview.example',
        service: 'https://127.0.0.1:443',
        desired: 'present',
        applied: 'pending',
      },
    ];
    const result = await reconcileCloudflare(
      records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    expect(result.ok).toBe(false);
    expect(result.records[0]).toMatchObject({ applied: 'error' });
    expect(result.records[0]!.error).toMatch(/does not own/);
    expect(world.dns.get('a-1-drupal.preview.example')).toMatchObject({
      id: 'foreign-1',
    });
  });

  it('an ingress-upload failure marks the active record `pending` (retryable) and never reaches DNS deletion', async () => {
    const world = fakeWorld();
    world.dns.set('a-1-mailpit.preview.example', {
      id: 'rec-9',
      content: tunnelCnameTarget(IDENTITY),
    });
    world.setFailNextUpload();
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'drupal',
        hostname: 'a-1-drupal.preview.example',
        service: 'https://127.0.0.1:443',
        desired: 'present',
        applied: 'pending',
      },
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'mailpit',
        hostname: 'a-1-mailpit.preview.example',
        service: 'http://127.0.0.1:8026',
        data: { dnsRecordId: 'rec-9' },
        desired: 'absent',
        applied: 'pending',
      },
    ];
    const result = await reconcileCloudflare(
      records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    expect(result.ok).toBe(false);
    expect(result.records.find((r) => r.key === 'drupal')).toMatchObject({
      applied: 'pending',
    });
    expect(world.dns.has('a-1-mailpit.preview.example')).toBe(true);
    expect(result.records.find((r) => r.key === 'mailpit')).toMatchObject({
      desired: 'absent',
    });
  });

  it('I1: refuses to PUT when the remote ingress carries an unmanaged rule', async () => {
    const world = fakeWorld({
      remoteIngress: [
        { hostname: 'someone-else.preview.example', service: 'http://x' },
      ],
    });
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'drupal',
        hostname: 'a-1-drupal.preview.example',
        service: 'https://127.0.0.1:443',
        desired: 'present',
        applied: 'pending',
      },
    ];
    const result = await reconcileCloudflare(
      records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    expect(result.ok).toBe(false);
    expect(world.uploads).toHaveLength(0);
    expect(result.records[0]!.error).toMatch(/unmanaged/);
  });

  it('C1: a failed PUT followed by a successful reconcile keeps every present hostname', async () => {
    const world = fakeWorld();
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'drupal',
        hostname: 'a-1-drupal.preview.example',
        service: 'https://127.0.0.1:443',
        desired: 'present',
        applied: 'pending',
      },
      {
        worktree: '/wt/b',
        ticket: 'b-2',
        key: 'mailpit',
        hostname: 'b-2-mailpit.preview.example',
        service: 'http://127.0.0.1:8026',
        desired: 'present',
        applied: 'pending',
      },
    ];
    world.setFailNextUpload();
    const failed = await reconcileCloudflare(
      records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    expect(failed.ok).toBe(false);

    const retried = await reconcileCloudflare(
      failed.records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    expect(retried.ok).toBe(true);
    const ingress = world.uploads.at(-1)!.ingress as { hostname?: string }[];
    expect(
      ingress
        .filter((r) => 'hostname' in r)
        .map((r) => r.hostname)
        .sort(),
    ).toEqual(['a-1-drupal.preview.example', 'b-2-mailpit.preview.example']);
    expect(retried.records.every((r) => r.applied === 'applied')).toBe(true);
  });

  it('down: uploads the reduced ingress before deleting the owned CNAME, then drops the tombstone', async () => {
    const world = fakeWorld();
    world.dns.set('a-1-drupal.preview.example', {
      id: 'rec-1',
      content: tunnelCnameTarget(IDENTITY),
    });
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'drupal',
        hostname: 'a-1-drupal.preview.example',
        service: 'https://127.0.0.1:443',
        data: { dnsRecordId: 'rec-1' },
        desired: 'absent',
        applied: 'pending',
      },
    ];
    const result = await reconcileCloudflare(
      records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(0);
    expect(world.dns.has('a-1-drupal.preview.example')).toBe(false);
    const lastUpload = world.uploads.at(-1)!.ingress as unknown[];
    expect(lastUpload).toEqual([{ service: 'http_status:404' }]);
  });

  it('delete failure leaves a tombstone and never touches sibling records', async () => {
    const world = fakeWorld();
    world.dns.set('a-1-drupal.preview.example', {
      id: 'rec-1',
      content: tunnelCnameTarget(IDENTITY),
    });
    const origDelete = world.deps.fetch;
    world.deps.fetch = async (url, init) => {
      if (/\/dns_records\/rec-1$/.test(url) && init.method === 'DELETE') {
        return jsonResponse(500, {
          success: false,
          errors: [{ message: 'delete failed' }],
        });
      }
      return origDelete(url, init);
    };
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'drupal',
        hostname: 'a-1-drupal.preview.example',
        service: 'https://127.0.0.1:443',
        data: { dnsRecordId: 'rec-1' },
        desired: 'absent',
        applied: 'pending',
      },
      {
        worktree: '/wt/b',
        ticket: 'b-2',
        key: 'mailpit',
        hostname: 'b-2-mailpit.preview.example',
        service: 'http://127.0.0.1:8026',
        desired: 'present',
        applied: 'pending',
      },
    ];
    const result = await reconcileCloudflare(
      records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    expect(result.ok).toBe(false);
    const drupal = result.records.find((r) => r.key === 'drupal');
    expect(drupal).toMatchObject({ desired: 'absent', applied: 'error' });
    const mailpit = result.records.find((r) => r.key === 'mailpit');
    expect(mailpit).toMatchObject({ applied: 'applied' });
  });

  it('uncertain DNS create (ambiguous/timeout) reconciles by readback instead of erroring', async () => {
    const world = fakeWorld();
    world.setUncertainNextCreate();
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'drupal',
        hostname: 'a-1-drupal.preview.example',
        service: 'https://127.0.0.1:443',
        desired: 'present',
        applied: 'pending',
      },
    ];
    const result = await reconcileCloudflare(
      records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    expect(result.ok).toBe(true);
    expect(result.records[0]!.applied).toBe('applied');
    expect(result.records[0]!.data?.dnsRecordId).toBe('rec-1');
  });

  it('hostHeader translates to originRequest.httpHostHeader', async () => {
    const world = fakeWorld();
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'storybook',
        hostname: 'a-1-storybook.preview.example',
        service: 'http://127.0.0.1:6006',
        hostHeader: 'localhost:6006',
        desired: 'present',
        applied: 'pending',
      },
    ];
    await reconcileCloudflare(
      records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    const ingress = world.uploads[0]!.ingress as {
      hostname?: string;
      originRequest?: { httpHostHeader?: string; noTLSVerify?: boolean };
    }[];
    const rule = ingress.find(
      (r) => r.hostname === 'a-1-storybook.preview.example',
    );
    expect(rule?.originRequest).toEqual({ httpHostHeader: 'localhost:6006' });
  });

  it('insecureTls translates to originRequest.noTLSVerify; omission NEVER disables verification', async () => {
    const world = fakeWorld();
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'drupal',
        hostname: 'a-1-drupal.preview.example',
        service: 'https://127.0.0.1:443',
        insecureTls: true,
        desired: 'present',
        applied: 'pending',
      },
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'other',
        hostname: 'a-1-other.preview.example',
        service: 'https://127.0.0.1:9443',
        // insecureTls omitted entirely
        desired: 'present',
        applied: 'pending',
      },
    ];
    await reconcileCloudflare(
      records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    const ingress = world.uploads[0]!.ingress as {
      hostname?: string;
      originRequest?: { noTLSVerify?: boolean };
    }[];
    const insecure = ingress.find(
      (r) => r.hostname === 'a-1-drupal.preview.example',
    );
    const omitted = ingress.find(
      (r) => r.hostname === 'a-1-other.preview.example',
    );
    expect(insecure?.originRequest).toEqual({ noTLSVerify: true });
    // Omission must not even carry `noTLSVerify: false` — absent means
    // Cloudflare's own default (verified), never an explicit disable.
    expect(omitted?.originRequest).toBeUndefined();
  });

  it('a direct container origin leaves the ingress rule unchanged', async () => {
    const containerWeb: TunnelDesiredRecord = {
      worktree: '/wt/a',
      ticket: 'a-1',
      key: 'web',
      hostname: 'a-1-web.preview.example',
      service: 'https://127.0.0.1:443',
      hostHeader: 'a-1.local.test',
      insecureTls: true,
      desired: 'present',
      applied: 'pending',
    };
    const ingressFor = async (record: TunnelDesiredRecord) => {
      const world = fakeWorld();
      await reconcileCloudflare(
        [record],
        { ...IDENTITY },
        world.deps,
        world.context,
      );
      return world.uploads[0]!.ingress;
    };
    const withDirect = await ingressFor({
      ...containerWeb,
      direct: 'http://172.18.0.19:80',
    });
    expect(withDirect).toEqual(await ingressFor(containerWeb));
    expect(withDirect[0]).toMatchObject({
      service: 'https://127.0.0.1:443',
      originRequest: { httpHostHeader: 'a-1.local.test', noTLSVerify: true },
    });
  });

  it('sentinel-secret: a failed DNS acquisition never leaks the API token into persisted state or the returned error', async () => {
    const world = fakeWorld();
    world.setFailNextCreate();
    const records: TunnelDesiredRecord[] = [
      {
        worktree: '/wt/a',
        ticket: 'a-1',
        key: 'drupal',
        hostname: 'a-1-drupal.preview.example',
        service: 'https://127.0.0.1:443',
        desired: 'present',
        applied: 'pending',
      },
    ];
    const SENTINEL = IDENTITY.apiToken;
    const result = await reconcileCloudflare(
      records,
      { ...IDENTITY },
      world.deps,
      world.context,
    );
    expect(result.ok).toBe(false);
    const serialized = JSON.stringify(result.records);
    expect(serialized).not.toContain(SENTINEL);
    expect(result.records[0]!.error).not.toContain(SENTINEL);
  });
});
