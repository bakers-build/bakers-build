// Shared JSON:API contract steps: the API client, its requests, and the
// collection/document assertions every API feature composes.
// Consumers: features/api, conductors, deployments, runs, statistics, tickets,
// workspace. Feature-specific API steps live with their feature.
import { createBdd } from 'playwright-bdd';
import { test, expect } from '../../bdd.fixtures';

const { Given, When, Then } = createBdd(test);

Given('the API client is {string}', async ({ apiClient }, account: string) => {
    await apiClient.identify(account);
});

Given('the API client identifies as the bakers CLI {string}', async ({ apiClient }, version: string) => {
    apiClient.identifyAsBakersCli(version);
});

Given('the API client uses a session token for {string}', async ({ apiClient }, account: string) => {
    await apiClient.identifyOAuth(account);
});

Given('the API client uses the owner client-credentials session token', async ({ apiClient }) => {
    await apiClient.identifyOAuth('fixture-conductor-owner');
});

When('the API client reads {string}', async ({ apiClient }, path: string) => {
    await apiClient.read(path);
});

Then('the API response status is {int}', async ({ apiClient }, status: number) => {
    expect(apiClient.response, 'A request must precede the response assertion').toBeDefined();
    expect(apiClient.response!.status(), await apiClient.response!.text()).toBe(status);
});

Then('the API collection contains {string}', async ({ apiClient }, fixture: string) => {
    const document = await apiClient.response!.json();
    expect(document.data).toEqual(expect.any(Array));
    expect(document.data.map((row: { id: string }) => row.id)).toContain(apiClient.fixtureId(fixture));
});

Then('the API collection is empty', async ({ apiClient }) => {
    const document = await apiClient.response!.json();
    expect(document.data).toEqual([]);
});

Then('the API document contains:', async ({ apiClient }, expected: string) => {
    expect(await apiClient.response!.json()).toMatchObject(JSON.parse(apiClient.resolve(expected)));
});

When('the API client sends {string} to {string}:', async ({ apiClient }, method: string, path: string, document: string) => {
    await apiClient.send(method, path, document);
});

When('the API resource is remembered as {string}', async ({ apiClient }, name: string) => {
    await apiClient.remember(name);
});

Then('the API resource is not {string}', async ({ apiClient }, name: string) => {
    const body = await apiClient.response!.json();
    expect(body.data?.id).toEqual(expect.any(String));
    expect(body.data.id).not.toBe(apiClient.fixtureId(`saved.${name}`));
});

Then('the API error mentions {string}', async ({ apiClient }, fragment: string) => {
    const document = await apiClient.response!.json();
    expect(document.errors).toEqual(expect.any(Array));
    expect(JSON.stringify(document.errors)).toContain(fragment);
});

When('the API client creates a {string} ticket in {string} as {string}', async ({ apiClient }, workflow: string, project: string, name: string) => {
    await apiClient.send('POST', '/jsonapi/bb_ticket/bb_ticket', JSON.stringify({
        data: {
            type: 'bb_ticket--bb_ticket',
            attributes: { title: `API ${name} contract`, workflow },
            relationships: { project_id: { data: { type: 'bb_project--bb_project', id: apiClient.fixtureId(`project.${project}`) } } },
        },
    }));
    expect(apiClient.response!.status(), await apiClient.response!.text()).toBe(201);
    await apiClient.remember(name);
});

When('the API client changes ticket {string} to state {string}', async ({ apiClient }, name: string, state: string) => {
    const id = apiClient.fixtureId(`saved.${name}`);
    await apiClient.send('PATCH', `/jsonapi/bb_ticket/bb_ticket/${id}`, JSON.stringify({
        data: { type: 'bb_ticket--bb_ticket', id, attributes: { state } },
    }));
});
