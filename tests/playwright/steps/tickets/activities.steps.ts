import { createBdd } from 'playwright-bdd';
import { test, expect } from '../../bdd.fixtures';

const { When, Then } = createBdd(test);

type JsonApiResource = {
    id: string;
    type: string;
    attributes?: Record<string, unknown>;
    relationships?: Record<string, { data?: { id: string; type: string } | Array<{ id: string; type: string }> | null }>;
};

type JsonApiDocument = {
    data?: JsonApiResource | JsonApiResource[];
    included?: JsonApiResource[];
    meta?: { count?: number };
};

function collection(document: JsonApiDocument): JsonApiResource[] {
    expect(document.data).toEqual(expect.any(Array));
    return document.data as JsonApiResource[];
}

function ticketIdOf(row: JsonApiResource): string | undefined {
    const related = row.relationships?.ticket_id?.data;
    if (related && !Array.isArray(related)) {
        return related.id;
    }
    return undefined;
}

function runIdOf(row: JsonApiResource): string | undefined {
    const related = row.relationships?.run_id?.data;
    if (related && !Array.isArray(related)) {
        return related.id;
    }
    return undefined;
}

When('the API client remembers the activity collection ids as {string}', async ({ apiClient }, name: string) => {
    const rows = collection(await apiClient.response!.json());
    apiClient.values.set(name, rows.map((row) => row.id));
});

When('the API collection row {int} is remembered as {string}', async ({ apiClient }, index: number, name: string) => {
    await apiClient.rememberCollectionRow(name, index);
});

When('the API client bounces ticket {string} between plan and qualification {int} times', async ({ apiClient }, name: string, count: number) => {
    let next = 'plan';
    for (let i = 0; i < count; i++) {
        const id = apiClient.fixtureId(`saved.${name}`);
        await apiClient.send('PATCH', `/jsonapi/bb_ticket/bb_ticket/${id}`, JSON.stringify({
            data: { type: 'bb_ticket--bb_ticket', id, attributes: { state: next } },
        }));
        expect(apiClient.response!.status(), await apiClient.response!.text()).toBe(200);
        next = next === 'plan' ? 'qualification' : 'plan';
    }
});

When('two API clients {string} send {string} to {string} at once:', async ({ apiClient }, account: string, method: string, path: string, document: string) => {
    await apiClient.identify(account);
    await apiClient.sendConcurrent(account, method, path, document);
});

When('walking both activity pages of ticket {string} yields {int} rows', async ({ apiClient }, name: string, total: number) => {
    const ticket = apiClient.fixtureId(`saved.${name}`);
    const seen: string[] = [];
    for (const offset of [0, 20]) {
        await apiClient.read(`/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]=${ticket}&sort=-drupal_internal__id&page[limit]=20&page[offset]=${offset}`);
        expect(apiClient.response!.status(), await apiClient.response!.text()).toBe(200);
        const document = await apiClient.response!.json() as JsonApiDocument;
        expect(document.meta).not.toHaveProperty('omitted');
        seen.push(...collection(document).map((row) => row.id));
    }
    expect(seen).toHaveLength(total);
    apiClient.values.set('paged-ids', seen);
});

Then('the activity collection ids match {string}', async ({ apiClient }, name: string) => {
    const expected = apiClient.values.get(name);
    expect(expected).toEqual(expect.any(Array));
    const rows = collection(await apiClient.response!.json());
    expect(rows.map((row) => row.id)).toEqual(expected);
});

Then('exactly one status_changed activity records {string} to {string}', async ({ apiClient }, previous: string, next: string) => {
    const rows = collection(await apiClient.response!.json());
    const matches = rows.filter((row) => row.attributes?.kind === 'status_changed'
        && row.attributes?.previous_state === previous
        && row.attributes?.new_state === next);
    expect(matches).toHaveLength(1);
    apiClient.values.set('matched-activity', matches[0]);
});

Then('its actor is user {string}', async ({ apiClient }, fixture: string) => {
    const row = apiClient.values.get('matched-activity') as JsonApiResource | undefined;
    expect(row).toBeDefined();
    const actor = row!.relationships?.actor?.data;
    expect(actor && !Array.isArray(actor) ? actor.id : undefined).toBe(apiClient.fixtureId(fixture));
});

Then('the activity collection ticket ids are only {string}', async ({ apiClient }, name: string) => {
    const expected = apiClient.fixtureId(`saved.${name}`);
    const rows = collection(await apiClient.response!.json());
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map(ticketIdOf))).toEqual(new Set([expected]));
});

Then('the activity collection includes tickets {string} and {string}', async ({ apiClient }, first: string, second: string) => {
    const ids = new Set(collection(await apiClient.response!.json()).map(ticketIdOf));
    expect(ids.has(apiClient.fixtureId(`saved.${first}`))).toBe(true);
    expect(ids.has(apiClient.fixtureId(`saved.${second}`))).toBe(true);
});

Then('the activity collection excludes tickets {string} and fixture {string}', async ({ apiClient }, savedName: string, fixture: string) => {
    const ids = new Set(collection(await apiClient.response!.json()).map(ticketIdOf));
    expect(ids.has(apiClient.fixtureId(`saved.${savedName}`))).toBe(false);
    expect(ids.has(apiClient.fixtureId(fixture))).toBe(false);
});

Then('exactly one claimed activity matches run {string} conductor {string} step {string} actor {string}', async ({ apiClient }, run: string, conductor: string, step: string, actor: string) => {
    const rows = collection(await apiClient.response!.json());
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.attributes?.kind).toBe('claimed');
    expect(row.attributes?.step).toBe(step);
    const runRel = row.relationships?.run_id?.data;
    const conductorRel = row.relationships?.conductor_id?.data;
    const actorRel = row.relationships?.actor?.data;
    expect(runRel && !Array.isArray(runRel) ? runRel.id : undefined).toBe(apiClient.fixtureId(`saved.${run}`));
    expect(conductorRel && !Array.isArray(conductorRel) ? conductorRel.id : undefined).toBe(apiClient.fixtureId(`saved.${conductor}`));
    expect(actorRel && !Array.isArray(actorRel) ? actorRel.id : undefined).toBe(apiClient.fixtureId(actor));
});

Then('the activity collection has {int} {word} row(s)', async ({ apiClient }, count: number, kind: string) => {
    const rows = collection(await apiClient.response!.json());
    expect(rows.filter((row) => row.attributes?.kind === kind)).toHaveLength(count);
});

Then('exactly one {word} activity references run {string} at step {string}', async ({ apiClient }, kind: string, run: string, step: string) => {
    const rows = collection(await apiClient.response!.json()).filter((row) => row.attributes?.kind === kind);
    expect(rows).toHaveLength(1);
    expect(runIdOf(rows[0])).toBe(apiClient.fixtureId(`saved.${run}`));
    expect(rows[0].attributes?.step).toBe(step);
});

Then('exactly one created activity records state {string} by user {string}', async ({ apiClient }, state: string, fixture: string) => {
    const rows = collection(await apiClient.response!.json()).filter((row) => row.attributes?.kind === 'created');
    expect(rows).toHaveLength(1);
    expect(rows[0].attributes?.new_state).toBe(state);
    const actor = rows[0].relationships?.actor?.data;
    expect(actor && !Array.isArray(actor) ? actor.id : undefined).toBe(apiClient.fixtureId(fixture));
});

Then('the concurrent responses are {int} and {int}', async ({ apiClient }, a: number, b: number) => {
    const statuses = apiClient.values.get('concurrent-statuses') as number[] | undefined;
    expect(statuses).toBeDefined();
    expect([...statuses!].sort((left, right) => left - right)).toEqual([a, b].sort((left, right) => left - right));
});

Then('the activity collection is sorted by descending internal id', async ({ apiClient }) => {
    const rows = collection(await apiClient.response!.json());
    const ids = rows.map((row) => Number(row.attributes?.drupal_internal__id));
    expect(ids.length).toBeGreaterThan(1);
    const sorted = [...ids].sort((left, right) => right - left);
    expect(ids).toEqual(sorted);
});

Then('those pages skip and duplicate nothing', async ({ apiClient }) => {
    const seen = apiClient.values.get('paged-ids') as string[] | undefined;
    expect(seen).toEqual(expect.any(Array));
    expect(new Set(seen).size).toBe(seen!.length);
});

Then('the claimed activity omits inaccessible related identities', async ({ apiClient }) => {
    const rows = collection(await apiClient.response!.json());
    const claimed = rows.filter((row) => row.attributes?.kind === 'claimed');
    expect(claimed).toHaveLength(1);
    expect(claimed[0].relationships?.actor?.data ?? null).toBeNull();
});

Then('the activity collection excludes resource {string}', async ({ apiClient }, name: string) => {
    const id = apiClient.fixtureId(`saved.${name}`);
    const rows = collection(await apiClient.response!.json());
    expect(rows.map((row) => row.id)).not.toContain(id);
});
