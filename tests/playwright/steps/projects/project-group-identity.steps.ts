// The project/group `description` and `image` over JSON:API: writes through
// the scenario's API client, readbacks through a separate administrator
// context so a refused write is checked against what is really stored.
// Consumer: features/projects/project-group-identity.feature.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBdd } from 'playwright-bdd';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { php } from '../../support/drush';

const { Given, When, Then } = createBdd(test);

type Subject = 'project' | 'group' | 'workspace';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');
const PASSWORD = 'Bb-test-login-426!';

function resource(subject: Subject): { type: string; path: string } {
  const type = `bb_${subject}--bb_${subject}`;
  return { type, path: `/jsonapi/${type.replace('--', '/')}` };
}

/** An HTTP context for one recipe-test account. */
async function contextFor(playwright: { request: { newContext: (options: object) => Promise<APIRequestContext> } }, baseURL: string, account: string): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    httpCredentials: { username: account, password: PASSWORD, send: 'always', origin: new URL(baseURL).origin },
    extraHTTPHeaders: { Accept: 'application/vnd.api+json' },
  });
}

/** The stored resource, with its image file included, read as the administrator. */
async function stored(playwright: never, baseURL: string, subject: Subject, id: string): Promise<{ data: any; included?: any[] }> {
  const admin = await contextFor(playwright, baseURL, 'login-admin');
  try {
    const response = await admin.get(`${resource(subject).path}/${id}?include=image`, { maxRedirects: 0 });
    expect(response.status(), await response.text()).toBe(200);
    return await response.json();
  } finally {
    await admin.dispose();
  }
}

/** A minimal valid lossless WebP (1×1). */
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');

function oversizePng(): Buffer {
  // A real PNG header padded past 2 MB; the size check runs before decoding.
  const png = readFileSync(join(FIXTURES, 'avatar-wide.png'));
  return Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024 + 1024)]);
}

Given(
  /^the (project|group|workspace) "([^"]+)" has no description and no image$/,
  async ({ playwright, baseURL, apiClient }, subject: Subject, fixture: string) => {
    const id = apiClient.fixtureId(fixture);
    const admin = await contextFor(playwright as never, baseURL!, 'login-admin');
    try {
      const response = await admin.fetch(`${resource(subject).path}/${id}`, {
        method: 'PATCH',
        maxRedirects: 0,
        headers: { 'Content-Type': 'application/vnd.api+json' },
        data: {
          data: {
            type: resource(subject).type,
            id,
            attributes: { description: null },
            relationships: { image: { data: null } },
          },
        },
      });
      expect(response.status(), await response.text()).toBe(200);
    } finally {
      await admin.dispose();
    }
  },
);

When(
  /^the API client sets the (project|group|workspace) "([^"]+)" description to (\d+) "(.)" characters$/,
  async ({ apiClient }, subject: Subject, fixture: string, count: string, character: string) => {
    await setDescription(apiClient, subject, fixture, character.repeat(Number(count)));
  },
);

When(
  /^the API client sets the (project|group|workspace) "([^"]+)" description to "(.*)"$/,
  async ({ apiClient }, subject: Subject, fixture: string, text: string) => {
    await setDescription(apiClient, subject, fixture, text);
  },
);

async function setDescription(apiClient: any, subject: Subject, fixture: string, text: string): Promise<void> {
  const id = apiClient.fixtureId(fixture);
  await apiClient.send('PATCH', `${resource(subject).path}/${id}`, JSON.stringify({
    data: { type: resource(subject).type, id, attributes: { description: text } },
  }));
}

When(
  /^the API client uploads "([^"]+)" as the (project|group|workspace) "([^"]+)" image$/,
  async ({ apiClient }, file: string, subject: Subject, fixture: string) => {
    await apiClient.upload(`${resource(subject).path}/${apiClient.fixtureId(fixture)}/image`, file, readFileSync(join(FIXTURES, file)));
  },
);

When(
  /^the API client uploads (a WebP|an SVG|a PNG larger than 2 MB) as the (project|group|workspace) "([^"]+)" image$/,
  async ({ apiClient }, kind: string, subject: Subject, fixture: string) => {
    const [name, body] = kind === 'a WebP' ? ['avatar.webp', WEBP] : kind === 'an SVG' ? ['avatar.svg', SVG] : ['huge.png', oversizePng()];
    await apiClient.upload(`${resource(subject).path}/${apiClient.fixtureId(fixture)}/image`, name, body);
  },
);

When(
  /^the API client clears the (project|group|workspace) "([^"]+)" image$/,
  async ({ apiClient }, subject: Subject, fixture: string) => {
    const id = apiClient.fixtureId(fixture);
    await apiClient.send('PATCH', `${resource(subject).path}/${id}`, JSON.stringify({
      data: { type: resource(subject).type, id, relationships: { image: { data: null } } },
    }));
  },
);

When(
  /^the API client reads the (project|group|workspace) "([^"]+)"$/,
  async ({ apiClient }, subject: Subject, fixture: string) => {
    await apiClient.read(`${resource(subject).path}/${apiClient.fixtureId(fixture)}`);
  },
);

Then('the API response is refused', async ({ apiClient }) => {
  expect(apiClient.response, 'A request must precede the response assertion').toBeDefined();
  // 403 or 404: the access policy may hide existence, which is its choice.
  expect([403, 404], await apiClient.response!.text()).toContain(apiClient.response!.status());
});

Then(
  /^the (project|group|workspace) "([^"]+)" description reads (\d+) "(.)" characters$/,
  async ({ playwright, baseURL, apiClient }, subject: Subject, fixture: string, count: string, character: string) => {
    const document = await stored(playwright as never, baseURL!, subject, apiClient.fixtureId(fixture));
    expect(document.data.attributes.description).toBe(character.repeat(Number(count)));
  },
);

Then(
  /^the (project|group|workspace) "([^"]+)" description reads "(.*)"$/,
  async ({ playwright, baseURL, apiClient }, subject: Subject, fixture: string, text: string) => {
    const document = await stored(playwright as never, baseURL!, subject, apiClient.fixtureId(fixture));
    expect(document.data.attributes.description).toBe(text);
  },
);

Then(
  /^the (project|group|workspace) "([^"]+)" description is empty$/,
  async ({ playwright, baseURL, apiClient }, subject: Subject, fixture: string) => {
    const document = await stored(playwright as never, baseURL!, subject, apiClient.fixtureId(fixture));
    expect(document.data.attributes.description ?? '').toBe('');
  },
);

Then(
  /^the (project|group|workspace) "([^"]+)" has no image$/,
  async ({ playwright, baseURL, apiClient }, subject: Subject, fixture: string) => {
    const document = await stored(playwright as never, baseURL!, subject, apiClient.fixtureId(fixture));
    expect(document.data.relationships.image.data).toBeNull();
  },
);

Then(
  /^the (project|group|workspace) "([^"]+)" image is a private file$/,
  async ({ playwright, baseURL, apiClient }, subject: Subject, fixture: string) => {
    const document = await stored(playwright as never, baseURL!, subject, apiClient.fixtureId(fixture));
    const file = document.included?.find((entry) => entry.id === document.data.relationships.image.data?.id);
    expect(file, 'The image relationship names no included file').toBeDefined();
    expect(file.attributes.uri.value).toMatch(new RegExp(`^private://${subject}-images/`));
    expect(file.attributes.uri.url).toContain('/system/files/');
  },
);

// `/system/files` does not take basic auth, so the download runs in a real
// browser session of the account, where private-file access is decided.
Then(
  /^"([^"]+)" (may|may not) download the (project|group|workspace) "([^"]+)" image$/,
  async ({ playwright, baseURL, apiClient, page, authProvider }, account: string, verdict: string, subject: Subject, fixture: string) => {
    const document = await stored(playwright as never, baseURL!, subject, apiClient.fixtureId(fixture));
    const file = document.included?.find((entry) => entry.id === document.data.relationships.image.data?.id);
    expect(file, 'The image relationship names no included file').toBeDefined();
    const uid = php(
      `print (($u = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${account}"]))) ? $u->id() : "");`,
    );
    expect(uid, `No account named ${account}`).not.toBe('');
    await page.context().clearCookies();
    await authProvider.login(page, uid);
    const response = await page.request.get(file.attributes.uri.url, { maxRedirects: 0 });
    if (verdict === 'may') {
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toMatch(/^image\//);
    } else {
      expect([403, 404]).toContain(response.status());
    }
  },
);
