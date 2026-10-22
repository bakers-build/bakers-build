import type { APIRequestContext, APIResponse, PlaywrightWorkerArgs } from '@playwright/test';
import world from './contract-world.json';
import { php } from './drush';

/** One independent HTTP identity and response history per BDD scenario. */
export class ApiClient {
    private context?: APIRequestContext;
    readonly values = new Map<string, unknown>();
    response?: APIResponse;
    private readonly saved = new Map<string, { id: string; type: string; attributes?: Record<string, unknown> }>();
    private readonly created: Array<{ id: string; type: string }> = [];
    /** Sent on writes once the client speaks as the bakers CLI; claims require it. */
    private bakersClient: Record<string, string> = {};

    constructor(private readonly playwright: PlaywrightWorkerArgs['playwright'], private readonly baseURL: string) {}

    async identify(account: string): Promise<void> {
        await this.context?.dispose();
        this.context = await this.playwright.request.newContext({
            baseURL: this.baseURL,
            ignoreHTTPSErrors: true,
            // Public credentials of recipe-test accounts, never a real account.
            httpCredentials: account === 'anonymous' ? undefined : {
                username: account,
                password: 'Bb-test-login-426!',
                send: 'always',
                origin: new URL(this.baseURL).origin,
            },
            extraHTTPHeaders: { Accept: 'application/vnd.api+json' },
        });
    }

    /**
     * Mints a user-bound bb:session Bearer token and uses it for later
     * requests. The request context has no HTTP Basic credentials.
     */
    async identifyOAuth(account: string): Promise<void> {
        await this.context?.dispose();
        const clients: Record<string, string> = {
            'api-lead': 'bakers-e2e-session-lead',
            'api-member': 'bakers-e2e-session-member',
            'api-stranger': 'bakers-e2e-session-stranger',
            'api-conductor-owner': 'bakers-conductor-owner-e2e',
        };
        const clientId = clients[account];
        if (!clientId) {
            throw new Error(`No session consumer for ${account}`);
        }
        const mint = await this.playwright.request.newContext({
            baseURL: this.baseURL,
            ignoreHTTPSErrors: true,
        });
        try {
            const tokenRes = await mint.post('/oauth/token', {
                form: {
                    grant_type: 'client_credentials',
                    client_id: clientId,
                    client_secret: 'Bb-test-client-426!',
                    scope: 'bb:session',
                },
            });
            if (!tokenRes.ok()) {
                throw new Error(`OAuth token mint failed: ${tokenRes.status()}`);
            }
            const body = await tokenRes.json() as { access_token?: unknown };
            const token = body.access_token;
            if (typeof token !== 'string' || token === '') {
                throw new Error('OAuth token mint omitted access_token');
            }
            this.context = await this.playwright.request.newContext({
                baseURL: this.baseURL,
                ignoreHTTPSErrors: true,
                extraHTTPHeaders: {
                    Accept: 'application/vnd.api+json',
                    Authorization: `Bearer ${token}`,
                },
            });
        }
        finally {
            await mint.dispose();
        }
    }

    identifyAsBakersCli(version: string): void {
        this.bakersClient = { 'X-Bakers-Client': `bakers/${version}` };
    }

    async read(path: string): Promise<void> {
        if (!this.context) throw new Error('Select an API identity before making a request.');
        this.response = await this.context.get(this.resolve(path), { maxRedirects: 0 });
    }

    async send(method: string, path: string, document: string): Promise<void> {
        if (!this.context) throw new Error('Select an API identity before making a request.');
        this.response = await this.context.fetch(this.resolve(path), {
            method, data: JSON.parse(this.resolve(document)), maxRedirects: 0,
            headers: { 'Content-Type': 'application/vnd.api+json', ...this.bakersClient },
        });
        if (method === 'POST' && this.response.status() === 201) {
            const body = await this.response.json();
            if (body.data?.id && body.data?.type) this.created.push(body.data);
        }
    }

    /** Posts raw bytes to a JSON:API file-upload route, as core expects. */
    async upload(path: string, filename: string, body: Buffer): Promise<void> {
        if (!this.context) throw new Error('Select an API identity before making a request.');
        this.response = await this.context.post(this.resolve(path), {
            data: body, maxRedirects: 0,
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `file; filename="${filename}"` },
        });
    }

    trackCreated(resource: { id: string; type: string }): void {
        this.created.push(resource);
    }

    async remember(name: string): Promise<void> {
        if (!this.response?.ok()) throw new Error('Only successful resource responses can be saved.');
        const body = await this.response.json();
        if (!body.data?.id || !body.data?.type) throw new Error('The response must contain one resource.');
        this.saved.set(name, body.data);
    }

    async rememberCollectionRow(name: string, index = 0): Promise<void> {
        if (!this.response?.ok()) throw new Error('Only successful resource responses can be saved.');
        const body = await this.response.json();
        const row = Array.isArray(body.data) ? body.data[index] : undefined;
        if (!row?.id || !row?.type) throw new Error(`Collection row ${index} is missing.`);
        this.saved.set(name, row);
    }

    /**
     * Fires the same authenticated write twice at once. Used to exercise
     * MariaDB row locks over HTTP; sequential sends cannot.
     */
    async sendConcurrent(account: string, method: string, path: string, document: string): Promise<Array<{ status: number; json: unknown }>> {
        const resolvedPath = this.resolve(path);
        const data = JSON.parse(this.resolve(document));
        const origin = new URL(this.baseURL).origin;
        const make = () => this.playwright.request.newContext({
            baseURL: this.baseURL,
            ignoreHTTPSErrors: true,
            httpCredentials: {
                username: account,
                password: 'Bb-test-login-426!',
                send: 'always',
                origin,
            },
            extraHTTPHeaders: { Accept: 'application/vnd.api+json' },
        });
        const [left, right] = await Promise.all([make(), make()]);
        try {
            const responses = await Promise.all([left, right].map((context) => context.fetch(resolvedPath, {
                method,
                data,
                maxRedirects: 0,
                headers: { 'Content-Type': 'application/vnd.api+json', ...this.bakersClient },
            })));
            const results = [];
            for (const response of responses) {
                const json = await response.json().catch(() => null);
                if (method === 'POST' && response.status() === 201 && json?.data?.id && json?.data?.type) {
                    this.created.push(json.data);
                }
                results.push({ status: response.status(), json });
            }
            this.values.set('concurrent-statuses', results.map((result) => result.status));
            this.values.set('concurrent-bodies', results);
            return results;
        }
        finally {
            await Promise.all([left.dispose(), right.dispose()]);
        }
    }

    resolve(value: string): string {
        return value.replace(/\{([\w.-]+)\}/g, (_, name: string) => {
            if (name.startsWith('saved.')) {
                const resource = this.saved.get(name.slice(6));
                if (!resource) throw new Error(`No response saved as ${name}`);
                return resource.id;
            }
            const fixture = world[name as keyof typeof world];
            if (!fixture) throw new Error(`Unknown recipe fixture: ${name}`);
            return fixture.uuid;
        });
    }

    savedAttribute(name: string, attribute: string): unknown {
        const resource = this.saved.get(name);
        if (!resource) throw new Error(`No response saved as ${name}`);
        return resource.attributes?.[attribute];
    }

    fixtureId(name: string): string {
        return this.resolve(`{${name}}`);
    }

    async dispose(): Promise<void> {
        await this.context?.dispose();
        if (!this.created.length) return;
        const cleanup = await this.playwright.request.newContext({
            baseURL: this.baseURL, ignoreHTTPSErrors: true,
            httpCredentials: { username: 'login-admin', password: 'Bb-test-login-426!', send: 'always', origin: new URL(this.baseURL).origin },
        });
        const errors: unknown[] = [];
        try {
            for (const resource of this.created.reverse()) {
                const path = `/jsonapi/${resource.type.replace('--', '/')}/${resource.id}`;
                try {
                    const response = await cleanup.delete(path, { maxRedirects: 0 });
                    // A submitted, accepted or rejected review refuses DELETE by
                    // product rule; it is removed through storage instead. A
                    // draft's 403 stays an error.
                    if (response.status() === 403 && resource.type === 'bb_comment--review') {
                        const state = removeDecidedReview(resource.id);
                        if (state !== 'removed') {
                            throw new Error(`Cleanup ${path}: 403 for a ${state} review`);
                        }
                        continue;
                    }
                    if (![204, 404].includes(response.status())) {
                        throw new Error(`Cleanup ${path}: ${response.status()} ${await response.text()}`);
                    }
                } catch (error) {
                    errors.push(error);
                }
            }
            if (errors.length) throw new AggregateError(errors, 'API scenario cleanup failed.');
        } finally {
            await cleanup.dispose();
        }
    }
}

/** Deletes a non-draft review through storage; answers its state otherwise. */
function removeDecidedReview(uuid: string): string {
    if (!/^[0-9a-f-]{36}$/.test(uuid)) throw new Error(`Not a UUID: ${uuid}`);
    return php(
        `$s = \\Drupal::entityTypeManager()->getStorage("bb_comment"); `
        + `$r = current($s->loadByProperties(["uuid" => "${uuid}"])); `
        + `if (!$r) { print "removed"; return; } `
        + `$state = $r->get("review_state")->value; `
        + `if ($state === "draft") { print "draft"; return; } `
        + `$s->delete([$r]); print "removed";`,
    );
}
