import { describe, expect, it, vi } from 'vitest';
import {
  type CfFetchResponse,
  CloudflareApiError,
  type CloudflareConfig,
  type CloudflareDeps,
  createDnsRecord,
  deleteDnsRecord,
  findDnsRecord,
  getIngressConfig,
  putIngressConfig,
  tunnelCnameTarget,
} from '../src/cloudflare.js';

const CFG: CloudflareConfig = {
  accountId: 'acc-1',
  tunnelId: 'tun-1',
  zoneId: 'zone-1',
  zone: 'preview.example',
  apiToken: 'secret-token-xyz',
};

function jsonResponse(status: number, body: unknown): CfFetchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function depsWith(fetch: CloudflareDeps['fetch']): CloudflareDeps {
  return { fetch, timeoutMs: 1000 };
}

describe('putIngressConfig / getIngressConfig', () => {
  it('uploads to the configurations endpoint with the given ingress', async () => {
    const fetch = vi.fn(async (url: string, init) => {
      expect(url).toBe(
        'https://api.cloudflare.com/client/v4/accounts/acc-1/cfd_tunnel/tun-1/configurations',
      );
      expect(init.method).toBe('PUT');
      expect(init.headers.authorization).toBe('Bearer secret-token-xyz');
      const parsed = JSON.parse(init.body as string);
      expect(parsed.config.ingress.at(-1)).toEqual({
        service: 'http_status:404',
      });
      return jsonResponse(200, { success: true, result: {} });
    });
    await putIngressConfig(
      CFG,
      [
        { hostname: 'a.example', service: 'https://127.0.0.1:443' },
        { service: 'http_status:404' },
      ],
      depsWith(fetch),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads back the config and defaults to an empty ingress', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        success: true,
        result: { config: { ingress: [{ service: 'http_status:404' }] } },
      }),
    );
    const result = await getIngressConfig(CFG, depsWith(fetch));
    expect(result.ingress).toHaveLength(1);

    const emptyFetch = vi.fn(async () =>
      jsonResponse(200, { success: true, result: {} }),
    );
    expect((await getIngressConfig(CFG, depsWith(emptyFetch))).ingress).toEqual(
      [],
    );
  });
});

describe('DNS records', () => {
  it('finds an exact-name CNAME', async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toContain('/zones/zone-1/dns_records?type=CNAME&name=');
      return jsonResponse(200, {
        success: true,
        result: [{ id: 'rec-1', content: 'x' }],
      });
    });
    const record = await findDnsRecord(
      CFG,
      'pynq-42-drupal.preview.example',
      depsWith(fetch),
    );
    expect(record).toEqual({ id: 'rec-1', content: 'x' });
  });

  it('returns null when no record exists', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { success: true, result: [] }),
    );
    expect(
      await findDnsRecord(CFG, 'nowhere.example', depsWith(fetch)),
    ).toBeNull();
  });

  it('creates a proxied CNAME to this tunnel', async () => {
    const fetch = vi.fn(async (_url: string, init) => {
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({
        type: 'CNAME',
        name: 'pynq-42-drupal.preview.example',
        content: tunnelCnameTarget(CFG),
        proxied: true,
      });
      return jsonResponse(200, { success: true, result: { id: 'rec-2' } });
    });
    const record = await createDnsRecord(
      CFG,
      'pynq-42-drupal.preview.example',
      depsWith(fetch),
    );
    expect(record.id).toBe('rec-2');
  });

  it('deletes by record id', async () => {
    const fetch = vi.fn(async (url: string, init) => {
      expect(url).toBe(
        'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/rec-2',
      );
      expect(init.method).toBe('DELETE');
      return jsonResponse(200, { success: true, result: {} });
    });
    await deleteDnsRecord(CFG, 'rec-2', depsWith(fetch));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('error handling and redaction', () => {
  it('throws CloudflareApiError with Cloudflare error messages, never the token', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(400, {
        success: false,
        errors: [{ message: 'invalid hostname' }],
      }),
    );
    await expect(putIngressConfig(CFG, [], depsWith(fetch))).rejects.toThrow(
      CloudflareApiError,
    );
    try {
      await putIngressConfig(CFG, [], depsWith(fetch));
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('invalid hostname');
      expect(message).not.toContain(CFG.apiToken);
    }
  });

  it('redacts the token from a network-level failure too', async () => {
    const fetch = vi.fn(async () => {
      throw new Error(`connect failed with token ${CFG.apiToken} in the url`);
    });
    try {
      await getIngressConfig(CFG, depsWith(fetch));
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(CFG.apiToken);
      expect((err as Error).message).toContain('[REDACTED]');
    }
  });

  it('aborts after the configured timeout', async () => {
    const fetch = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<CfFetchResponse>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    await expect(
      getIngressConfig(CFG, { fetch, timeoutMs: 5 }),
    ).rejects.toThrow(CloudflareApiError);
  });
});

describe('createTransport settings', () => {
  it('names the replacement for a renamed camelCase key', async () => {
    const { default: createTransport } = await import('../src/index.js');
    await expect(
      createTransport({ zone: 'z', apiToken: 't' }, { home: '/tmp' }),
    ).rejects.toThrow('apiToken was renamed: use api_token');
  });
});
