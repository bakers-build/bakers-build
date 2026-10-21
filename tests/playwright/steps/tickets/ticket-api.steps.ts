import { createBdd } from 'playwright-bdd';
import { Drush } from '@key-tec/playwright-core';
import { test, expect } from '../../bdd.fixtures';

const { Given, When, Then } = createBdd(test);

Then('the response describes the ticket resource schema', async ({ apiClient }) => {
    const schema = await apiClient.response!.json();
    expect(schema).toHaveProperty('$schema');
    expect(schema).toHaveProperty('definitions.type.const', 'bb_ticket--bb_ticket');
});

Then('the API document includes resource {string}', async ({ apiClient }, name: string) => {
    const document = await apiClient.response!.json();
    expect(document.included).toEqual(expect.any(Array));
    expect(document.included.map((row: { id: string }) => row.id)).toContain(apiClient.fixtureId(name));
});

Given('the session actor owns a running lease for ticket {string}', async ({ apiClient }, name: string) => {
    const ticket = apiClient.fixtureId(`saved.${name}`);
    await apiClient.identify('login-admin');
    await apiClient.send('POST', '/jsonapi/bb_conductor/bb_conductor', JSON.stringify({
        data: {
            type: 'bb_conductor--bb_conductor',
            attributes: { conductor_id: `bdd-session-${ticket}`, label: 'BDD session conductor', status: 'online' },
            relationships: {
                owner_user_id: { data: { type: 'user--user', id: apiClient.fixtureId('user.session') } },
                project_id: { data: { type: 'bb_project--bb_project', id: apiClient.fixtureId('project.home') } },
            },
        },
    }));
    expect(apiClient.response!.status(), await apiClient.response!.text()).toBe(201);
    await apiClient.remember('session-conductor');
    // Registration normally upgrades the existing membership to app (GONE,
    // BB-462 D9). Restore this scenario's ORDINARY seeded rank so only
    // session write authority is under test, as in the original functional
    // contract — under D1 that ordinary floor is the explicit `contributor`
    // the implicit `member` rank used to grant for free, not an empty role
    // list, which now grants nothing at all.
    // This step runs from four feature files (comments, session-writeback,
    // optional-finish, writeback), each of which shares this seeded
    // membership fixture — but every call sets the SAME fixed role, and no
    // scenario in any of the four asserts the membership's role list itself
    // (only the ticket write authority it grants). A concurrent write of the
    // identical value from another worker settles on the same state either
    // way, so the shared write is a no-op collision rather than a race.
    const membership = apiClient.fixtureId('membership.session.workspace.home');
    Drush.exec(`php:eval '$m = \\Drupal::service("entity.repository")->loadEntityByUuid("og_membership", "${membership}"); if (!$m) { throw new \\RuntimeException("Missing session membership fixture"); } $r = \\Drupal::entityTypeManager()->getStorage("og_role")->load("bb_workspace-bb_workspace-contributor"); $m->set("roles", [$r])->save();'`);
    await apiClient.send('POST', '/jsonapi/bb_run/bb_run', JSON.stringify({
        data: {
            type: 'bb_run--bb_run',
            attributes: { state: 'running', claim_expires_at: new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, '+00:00') },
            relationships: {
                ticket_id: { data: { type: 'bb_ticket--bb_ticket', id: ticket } },
                conductor_id: { data: { type: 'bb_conductor--bb_conductor', id: apiClient.fixtureId('saved.session-conductor') } },
            },
        },
    }));
    expect(apiClient.response!.status(), await apiClient.response!.text()).toBe(201);
    await apiClient.remember('session-run');
    await apiClient.identify('api-session');
});

Then('the API document excludes included resource {string}', async ({ apiClient }, name: string) => {
    const document = await apiClient.response!.json();
    expect((document.included ?? []).map((resource: { id: string }) => resource.id)).not.toContain(apiClient.fixtureId(name));
});
