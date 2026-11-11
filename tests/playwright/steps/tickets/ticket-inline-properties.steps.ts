import { Given, When, Then } from '../../bdd.fixtures';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { Drush } from '../../support/drush';
import { createBdd } from 'playwright-bdd';
import { test } from '../../bdd.fixtures';
import world from '../../support/contract-world.json';
import { markDocument, documentWasKept } from '../../support/shell';

const { After } = createBdd(test);
const snapshots = new WeakMap<Page, { url: string; title: string; values: Record<string, string[]> }>();
const rejectedStatuses = new WeakMap<Page, number>();
const authenticatedCookies = new WeakMap<Page, Awaited<ReturnType<BrowserContext['cookies']>>>();
const fields: Record<string, string> = { Assignee: 'assignee_user_id', Reviewers: 'reviewers', Conductor: 'conductor_id', Priority: 'priority', Type: 'ticket_type', Recipe: 'recipe', Labels: 'labels', Parent: 'parent_id', 'Blocked by': 'blocked_by' };
const propertyForm = (page: Page) => page.locator('form[data-form-save]');
const savedMessage = (page: Page) => propertyForm(page).locator('#messages-status');
const saveButton = (page: Page) => propertyForm(page).getByRole('button', { name: 'Save', exact: true });
const picker = (page: Page, label: string) => propertyForm(page).locator(`[data-option-picker-name="${fields[label]}"]`);
const fieldStatus = (page: Page, label: string) => picker(page, label).locator('[data-picker-part="status"]');
const propertyPost = (page: Page) => page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/property'));

Then('the property form has a usable manual Save button', async ({ page }) => {
    const button = propertyForm(page).getByRole('button', { name: 'Save', exact: true });
    await expect(button).toBeVisible();
    await button.click();
    await expect(savedMessage(page)).toContainText(/bakers.build ticket .+ saved\./);
    await expect(button).toBeVisible();
});

Then('the selected inline labels are {string}', async ({ page }, labels: string) => {
    const control = picker(page, 'Labels');
    await control.getByRole('combobox').click();
    await expect(control.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
    // Compared as a SET, not as a sequence. `toHaveText(array)` asserts DOM order
    // too, and the order the picker paints its selected options in is not part of
    // what this scenario claims — it claims which labels survive a reload. The
    // stricter form passed on one runner and failed on another with the same
    // commit ("ui, bug" against a DOM that held bug before ui), which is a
    // property of the assertion rather than of the product.
    const expected = labels.split(', ').map(label => label.trim()).sort();
    await expect
        .poll(async () =>
            (await control.getByRole('option', { selected: true }).allTextContents())
                .map(text => text.trim())
                .sort(),
        )
        .toEqual(expected);
    await page.keyboard.press('Escape');
});

Then('the inline Labels menu fits the viewport at desktop and mobile sizes', async ({ page }) => {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        const control = picker(page, 'Labels');
        await control.getByRole('combobox').click();
        const panel = control.locator('[data-option-picker-panel]');
        await expect(panel).toBeVisible();
        const box = (await panel.boundingBox())!;
        expect.soft(box.x).toBeGreaterThanOrEqual(0);
        expect.soft(box.y).toBeGreaterThanOrEqual(0);
        expect.soft(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect.soft(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        await expect(control.getByRole('option').first().locator('.option-list__marker')).toBeInViewport({ ratio: 1 });
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(control.getByRole('combobox')).toBeFocused();
    }
});

Then('the Properties block exposes the people pickers', async ({ page }) => {
    await expect(propertyForm(page)).toHaveCount(1);
    for (const label of ['Assignee', 'Reviewers', 'Conductor', 'Priority', 'Labels']) {
        await expect(picker(page, label).locator('[data-option-picker-trigger]')).toBeVisible();
    }
});

Then('the Properties block holds the property pickers and Created by', async ({ page }) => {
    await expect(propertyForm(page)).toHaveCount(1);
    for (const label of ['Assignee', 'Reviewers', 'Conductor', 'Priority', 'Type', 'Recipe', 'Labels', 'Parent', 'Blocked by']) {
        await expect(picker(page, label).locator('[data-option-picker-trigger]')).toBeVisible();
    }
    // Stall leads when the ticket is standing still (frozen, blocked, no
    // conductor, failing) and is omitted when it is not. The nine pickers
    // follow, then the creator. Effort, Code and Relations are read-only
    // blocks of their own, outside the form.
    const labels = await propertyForm(page).locator('[data-cell="label"]').allTextContents();
    const afterStall = labels[0] === 'Stall' ? labels.slice(1) : labels;
    // Runs closes the block for a reader who may view runs.
    const beforeRuns = afterStall.at(-1) === 'Runs' ? afterStall.slice(0, -1) : afterStall;
    expect(beforeRuns).toEqual(['Assignee', 'Reviewers', 'Conductor', 'Priority', 'Type', 'Recipe', 'Labels', 'Parent', 'Blocked by', 'Created by']);
    // Relations renders only with sub-tickets or referenced tickets, so it
    // is not asserted here; Parent and Blocked by are rows of the form above.
    await expect(page.locator('[data-canvas-region="inspector"] details > summary', { hasText: /^\s*Code/ })).toHaveCount(1);
    await expect(page.getByText('Undefined array key')).toHaveCount(0);
});

Then('an ordinary form saves only on Save through HTMX after each replacement', async ({ page }) => {
    const submissions: URLSearchParams[] = [];
    let releaseResponse = () => {};
    const delayedResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
    const markup = (choice: string, saved = '') => `<form data-form-save hx-post="/save-preferences-fixture" hx-target="this" hx-swap="outerHTML" hx-sync="this:drop">
      ${saved ? `<div id="messages-status" data-drupal-messages>${saved}</div>` : ''}
      <label>Colour<select name="colour"><option${choice === 'red' ? ' selected' : ''}>red</option><option${choice === 'blue' ? ' selected' : ''}>blue</option></select></label>
      <input name="unrelated" value="preserved"><button type="submit" name="op" value="save">Save</button>
      <span role="alert" hidden data-form-save-status></span></form>`;
    await page.route('**/save-preferences-fixture', async route => {
        const data = new URLSearchParams(route.request().postData()!);
        submissions.push(data);
        if (submissions.length === 2) await delayedResponse;
        await route.fulfill({ contentType: 'text/html', body: markup(data.get('colour')!, 'Preferences saved.') });
    });
    await page.evaluate(html => {
        document.body.innerHTML = html;
        const runtime = window as unknown as { Drupal: { attachBehaviors(context: Element): void } };
        runtime.Drupal.attachBehaviors(document.querySelector('form')!);
    }, markup('red'));
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeVisible();
    // A change alone writes nothing.
    await page.getByLabel('Colour').selectOption('blue');
    await page.getByLabel('Colour').selectOption('red');
    await page.getByLabel('Colour').selectOption('blue');
    expect(submissions).toHaveLength(0);
    await save.click();
    await expect(page.locator('#messages-status')).toHaveText('Preferences saved.');
    await expect(save).toBeVisible();
    // A swapped-in form has no listener until Drupal re-attaches the behaviour.
    await expect(page.locator('form[data-form-save]')).toHaveAttribute('data-once', /\bform-save\b/);
    // An edit makes the previous outcome stale.
    await page.getByLabel('Colour').selectOption('red');
    await expect(page.locator('#messages-status')).toHaveCount(0);
    expect(submissions).toHaveLength(1);
    // A second Save while the first is in flight is dropped, not queued.
    await save.click();
    await expect.poll(() => submissions.length).toBe(2);
    await expect(page.locator('form[data-form-save]')).toHaveJSProperty('inert', true);
    await page.locator('form[data-form-save]').evaluate(form => (form as HTMLFormElement).requestSubmit());
    releaseResponse();
    await expect(page.locator('#messages-status')).toHaveText('Preferences saved.');
    await expect(page.getByLabel('Colour')).toHaveValue('red');
    expect(submissions.map(data => data.get('colour'))).toEqual(['blue', 'red']);
    expect(submissions.every(data => data.get('op') === 'save' && data.get('unrelated') === 'preserved')).toBe(true);
});

async function values(page: Page) {
    return propertyForm(page).locator('[data-option-picker-name]').evaluateAll(pickers => Object.fromEntries(pickers.map(p => [
        p.getAttribute('data-option-picker-name')!,
        // A pill posts hidden inputs; the rail's inline picker posts its
        // checked radios or checkboxes. Either is the field's selection.
        Array.from(
            p.querySelectorAll(':scope > input[type="hidden"], input[type="radio"]:checked, input[type="checkbox"]:checked'),
            input => (input as HTMLInputElement).value,
        ).filter(Boolean),
    ])));
}

async function formData(page: Page) {
    return propertyForm(page).evaluate(form => {
        const data = new FormData(form as HTMLFormElement);
        const submit = form.querySelector<HTMLButtonElement | HTMLInputElement>('[data-drupal-selector="edit-submit"], input[type="submit"]');
        if (!submit) {
            throw new Error('Property form has no actions submit');
        }
        data.set(submit.name, submit.value);
        return { url: (form as HTMLFormElement).action, entries: Array.from(data.entries()) as [string, string][] };
    });
}

function setField(data: URLSearchParams, field: string, selection: string[]) {
    data.delete(field);
    data.delete(`${field}[]`);
    const multiple = ['labels', 'reviewers', 'blocked_by'].includes(field);
    for (const value of selection) data.append(multiple ? `${field}[]` : field, value);
}

Then('separate stale property submissions preserve both editors changes', async ({ page }) => {
    const initial = await values(page);
    const { url, entries } = await formData(page);
    const otherEditor = await page.context().newPage();
    await otherEditor.goto(page.url());
    const otherForm = await formData(otherEditor);
    await otherEditor.close();
    expect(new URLSearchParams(otherForm.entries).get('form_build_id')).not.toBe(new URLSearchParams(entries).get('form_build_id'));
    const priority = initial.priority[0] === '1' ? '2' : '1';
    const conductor = await picker(page, 'Conductor').getByRole('option', { name: 'srv01-bakers', exact: true, includeHidden: true }).getAttribute('data-value');
    expect(conductor).toBeTruthy();
    const first = new URLSearchParams(entries);
    setField(first, 'priority', [priority]);
    const firstResponse = await post(page, url, first);
    expect(await firstResponse.text()).toContain('id="messages-status"');
    const stale = new URLSearchParams(otherForm.entries);
    setField(stale, 'conductor_id', [conductor!]);
    stale.set('title', 'Forged unconfigured title');
    stale.set('state', 'done');
    stale.set('project_id', '2147483647');
    const staleResponse = await post(page, url, stale);
    expect(await staleResponse.text()).toContain('id="messages-status"');
    await page.reload();
    const current = await values(page);
    expect(current.priority).toEqual([priority]);
    expect(current.conductor_id).toEqual([conductor]);
    expect(current.labels).toEqual(initial.labels);
    await expect(page).toHaveTitle(snapshots.get(page)!.title);
});

async function post(page: Page, url: string, data: URLSearchParams) {
    return page.request.post(url, { data: data.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
}

Then('a saved property form refuses a different ticket route', async ({ page }) => {
    const opening = (await values(page)).priority[0];
    const saved = opening === '1' ? '2' : '1';
    await pick(page, 'Priority', saved === '1' ? 'High' : 'Medium');
    await expect(fieldStatus(page, 'Priority')).toHaveText('Saved');
    const { entries } = await formData(page);
    const fixture = world['ticket.home'];
    const otherRoute = Drush.exec(`ev 'print current(\\Drupal::entityTypeManager()->getStorage("${fixture.entityType}")->loadByProperties(["uuid" => "${fixture.uuid}"]))->toUrl()->toString();'`).trim();
    const data = new URLSearchParams(entries);
    setField(data, 'priority', [opening]);
    const response = await post(page, `${otherRoute}/property`, data);
    expect(response.status()).toBe(403);
    await page.reload();
    expect((await values(page)).priority).toEqual([saved]);
});

Then('a second pick after the replacement persists and an in-flight save is not repeated', async ({ page }) => {
    const opening = (await values(page)).priority[0];
    expect(opening).toBeTruthy();
    const posts: string[] = [];
    page.on('request', request => {
        if (request.method() === 'POST' && request.url().includes('/property')) posts.push(request.postData() ?? '');
    });
    let releaseResponse = () => {};
    const heldResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
    await page.route('**/ticket/bb-142/property*', async route => {
        const response = await route.fetch();
        await heldResponse;
        await route.fulfill({ response });
    }, { times: 1 });
    await choose(page, 'Priority', opening === '1' ? 'Medium' : 'High');
    await expect.poll(() => posts.length).toBe(1);
    // The form is inert while its save is in flight; a programmatic submit
    // stands in for a second activation and is dropped.
    await expect(propertyForm(page)).toHaveJSProperty('inert', true);
    await propertyForm(page).evaluate(form => (form as HTMLFormElement).requestSubmit());
    releaseResponse();
    await expect(fieldStatus(page, 'Priority')).toHaveText('Saved');
    expect(posts).toHaveLength(1);
    await pick(page, 'Priority', opening === '1' ? 'High' : 'Medium');
    await expect(fieldStatus(page, 'Priority')).toHaveText('Saved');
    expect(posts).toHaveLength(2);
    await page.reload();
    expect((await values(page)).priority).toEqual([opening]);
});

/** Picks an option of an autosaving form and waits until its answer replaced the form. */
async function pick(page: Page, label: string, option: string) {
    const form = await propertyForm(page).elementHandle();
    const saved = propertyPost(page);
    await choose(page, label, option);
    await saved;
    await expect.poll(() => form!.evaluate(element => element.isConnected)).toBe(false);
    await expect(propertyForm(page)).not.toHaveAttribute('inert');
}

async function choose(page: Page, label: string, option: string) {
    const control = picker(page, label);
    await expect(propertyForm(page)).not.toHaveAttribute('inert');
    const trigger = control.locator('[data-option-picker-trigger]');
    const panel = control.locator('[data-option-picker-panel]');
    // Multi-select stays open after a pick. Clicking the trigger again would
    // close it and hide every option from getByRole.
    if (await trigger.getAttribute('aria-expanded') !== 'true') {
        await trigger.click();
    }
    await expect(panel).toBeVisible();
    const search = panel.locator('[data-option-picker-search]');
    if (await search.count()) {
        await search.fill(option);
    }
    // Administrators can see same-named terms from several fixture workspaces.
    // Select the committed label identity, not an arbitrary matching row.
    const row = label === 'Labels' && option === 'bug'
        ? control.locator(`[role="option"][data-value="${fixtureId('label.bug')}"]`)
        : control.getByRole('option', { name: option, exact: true });
    await expect(row).toHaveAccessibleName(option);
    await row.click();
}

Given('I remember the inline properties for cleanup', async ({ page }) => {
    await expect(propertyForm(page)).toHaveCount(1);
    snapshots.set(page, { url: page.url(), title: await page.title(), values: await values(page) });
});

// Writes back only the ticket THIS scenario itself opened (snapshots is keyed
// by `page`). Shared by both ticket-inline-properties feature files — each
// visits its own fixture ticket, so no scenario's restore ever touches
// another scenario's page.
After({ tags: '@feature:ticket-inline-properties' }, async ({ page, authProvider }) => {
    const snapshot = snapshots.get(page);
    if (!snapshot) return;
    await page.unrouteAll({ behavior: 'wait' });
    await authProvider.login(page, '1');
    await page.goto(snapshot.url);
    const { url, entries } = await formData(page);
    const data = new URLSearchParams(entries);
    for (const [field, selection] of Object.entries(snapshot.values)) setField(data, field, selection);
    const response = await post(page, url, data);
    expect(response.ok(), await response.text()).toBe(true);
    await page.goto(snapshot.url);
    expect(await values(page)).toEqual(snapshot.values);
    snapshots.delete(page);
});

When('I select inline {string} option {string}', async ({ page }, label: string, option: string) => {
    await markDocument(page);
    await pick(page, label, option);
});

When('I remove the inline {string} chip {string}', async ({ page }, label: string, option: string) => {
    await markDocument(page);
    const control = picker(page, label);
    await expect(control).toHaveAttribute('data-option-picker-ready');
    const button = control.getByRole('button', { name: `Remove ${option} from ${label}` });
    await expect(button).toBeVisible();
    const form = await propertyForm(page).elementHandle();
    const saved = propertyPost(page);
    await button.click();
    await saved;
    await expect.poll(() => form!.evaluate(element => element.isConnected)).toBe(false);
    await expect(button).toHaveCount(0);
    await expect(control.locator('[data-option-picker-chip]', { hasText: option })).toHaveCount(0);
});

Then('the inline {string} chips are {string}', async ({ page }, label: string, chips: string) => {
    const control = picker(page, label);
    const expected = chips === '' ? [] : chips.split(', ').map(name => name.trim());
    await expect.poll(async () =>
        (await control.locator('[data-option-picker-chip]').allTextContents())
            .map(text => text.trim())
            .filter(Boolean),
    ).toEqual(expected);
});

Then('the inline {string} picker does not offer {string}', async ({ page }, label: string, option: string) => {
    await expect(picker(page, label).getByRole('option', { name: option, exact: true })).toHaveCount(0);
});

Then('the property form shows no Save button', async ({ page }) => {
    // Save stays in the form as the fallback without JavaScript.
    await expect(propertyForm(page).getByRole('button', { name: 'Save', exact: true, includeHidden: true })).toBeAttached();
    await expect(saveButton(page)).toBeHidden();
});

Given('browser authentication is removed without reloading', async ({ page }) => {
    authenticatedCookies.set(page, await page.context().cookies());
    await page.context().clearCookies();
});

When('I save denied inline {string} option {string}', async ({ page }, label: string, option: string) => {
    const response = propertyPost(page);
    await choose(page, label, option);
    rejectedStatuses.set(page, (await response).status());
});

Then('the inline property save is rejected with HTTP {int}', async ({ page }, status: number) => {
    expect(rejectedStatuses.get(page)).toBe(status);
});

Then('the inline {string} save succeeds without navigation', async ({ page }, label: string) => {
    await expect(fieldStatus(page, label)).toHaveText('Saved');
    await expect(picker(page, label).getByRole('combobox')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(savedMessage(page)).toHaveCount(1);
    await expect(savedMessage(page)).toContainText(/bakers.build ticket .+ saved\./);
    await expect(saveButton(page)).toBeHidden();
    await expect(page).toHaveURL(snapshots.get(page)!.url);
    await expect(page).toHaveTitle(snapshots.get(page)!.title);
    expect(await documentWasKept(page)).toBe(true);
});

Then('the inline {string} selection is {string}', async ({ page }, label: string, value: string) => {
    await expect(picker(page, label).locator('[data-option-picker-trigger]')).toContainText(value);
});

Then('the inline {string} selection is empty', async ({ page }, label: string) => {
    expect((await values(page))[fields[label]]).toEqual([]);
});

Then('the inline {string} selection includes {string}', async ({ page }, label: string, value: string) => {
    await expect(picker(page, label).locator('[data-option-picker-trigger]')).toHaveAccessibleName(new RegExp(value));
    if (label === 'Labels') expect((await values(page)).labels).toEqual(expect.arrayContaining(snapshots.get(page)!.values.labels));
});

Then('dismissing the current priority sends no save and leaves it unchanged', async ({ page }) => {
    const before = await values(page);
    const writes: string[] = [];
    page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
    await picker(page, 'Priority').locator('[data-option-picker-trigger]').click();
    await page.keyboard.press('Escape');
    await page.reload();
    expect(writes).toEqual([]);
    expect(await values(page)).toEqual(before);
});

Given('the next conductor save contains an invalid reference', async ({ page }) => {
    await page.route('**/ticket/bb-142/property*', async route => {
        const data = new URLSearchParams(route.request().postData()!);
        data.set('conductor_id', '2147483647');
        await route.continue({ postData: data.toString() });
    }, { times: 1 });
});

Then('the inline {string} shows an unsaved error with the attempted value {string}', async ({ page }, label: string, value: string) => {
    // A validation error comes back as Drupal's error message; a request that
    // never completed is reported by the form's own alert. Neither claims success.
    await expect(propertyForm(page).getByRole('alert').filter({ hasText: /\S/ }).first()).toBeVisible();
    await expect(savedMessage(page)).toHaveCount(0);
    await expect(fieldStatus(page, label)).not.toHaveText('Saved');
    await expect(picker(page, label).locator('[data-option-picker-trigger]')).toContainText(value);
    await expect(saveButton(page)).toBeHidden();
});

Then('the inline {string} says {string}', async ({ page }, label: string, message: string) => {
    await expect(fieldStatus(page, label)).toHaveText(message);
    await expect(picker(page, label).getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
});

Then('the stored conductor is unchanged', async ({ page }) => {
    const other = await page.context().newPage();
    await other.goto(snapshots.get(page)!.url);
    expect((await values(other)).conductor_id).toEqual(snapshots.get(page)!.values.conductor_id);
    await other.close();
});

Then('an authenticated reload shows stored inline {string} option {string}', async ({ page }, label: string, option: string) => {
    await page.context().addCookies(authenticatedCookies.get(page)!);
    const other = await page.context().newPage();
    await other.goto(snapshots.get(page)!.url);
    await expect(picker(other, label).locator('[data-option-picker-trigger]')).toContainText(option);
    await other.close();
});

When('I correct the inline {string} selection', async ({ page }, label: string) => {
    await markDocument(page);
    await pick(page, label, 'srv01-bakers');
});

/** Resolves committed recipe data without creating hidden test fixtures. */
function fixtureId(name: keyof typeof world): string {
    const fixture = world[name];
    return Drush.exec(`ev 'print current(\\Drupal::entityTypeManager()->getStorage("${fixture.entityType}")->loadByProperties(["uuid" => "${fixture.uuid}"]))->id();'`).trim();
}

Then('invalid inline property requests are rejected without changing the ticket', async ({ page }) => {
    const before = await values(page);
    const { url, entries } = await formData(page);
    const cases: [string, string[]][] = [
        ['priority', ['99']], ['conductor_id', ['2147483647']],
        // A conductor of another workspace; `conductor.home` shares the ticket's workspace now.
        ['conductor_id', [fixtureId('conductor.pagination-other')]],
        // A label of another workspace; `term.label` shares the ticket's workspace now.
        ['labels', [fixtureId('term.other')]],
    ];
    for (const [field, selection] of cases) {
        const data = new URLSearchParams(entries);
        setField(data, field, selection);
        const response = await post(page, url, data);
        expect(response.status()).toBe(200);
        expect(await response.text()).toContain('id="messages-error"');
    }
    for (const submitted of [{ 'priority[0]': '1', 'priority[1]': '2' }, { 'priority[0][nested]': '1' }]) {
        const data = new URLSearchParams(entries);
        data.delete('priority');
        for (const [key, value] of Object.entries(submitted)) data.set(key, value!);
        const response = await post(page, url, data);
        expect(response.status()).toBe(200);
        expect(await response.text()).toContain('id="messages-error"');
    }
    const tampered = new URLSearchParams(entries);
    tampered.set('property_baseline', '{}');
    expect((await post(page, url, tampered)).status()).toBe(403);
    const forgedIdentity = new URLSearchParams(entries);
    forgedIdentity.set('form_build_id', 'form-forged');
    expect((await post(page, url, forgedIdentity)).status()).toBe(403);
    await page.reload();
    expect(await values(page)).toEqual(before);
});

Then('the inline save refuses missing CSRF tokens and users without update access', async ({ page }) => {
    const { url, entries } = await formData(page);
    const before = await values(page);
    const data = new URLSearchParams(entries);
    data.delete('form_token');
    setField(data, 'priority', ['1']);
    const noToken = await post(page, url, data);
    expect([200, 403]).toContain(noToken.status());
    if (noToken.status() === 200) expect(await noToken.text()).toContain('form has become outdated');
    await page.reload();
    expect(await values(page)).toEqual(before);
    await page.context().clearCookies();
    const login = await page.request.post('/user/login?_format=json', { data: { name: 'no-bakery', pass: 'Bb-test-login-426!' } });
    expect(login.ok(), await login.text()).toBe(true);
    expect([403, 404]).toContain((await post(page, url, new URLSearchParams(entries))).status());
    await page.context().clearCookies();
    expect([302, 403, 404]).toContain((await page.request.post(url, { data: new URLSearchParams(entries).toString(), maxRedirects: 0 })).status());
});

// Another editor's save, between this page's load and its own pick: written
// straight to storage, as the other tab's pick would have committed it.
When('another editor sets the priority of {string} to {string}', async ({}, identifier: string, priority: string) => {
    const value = ({ High: 1, Medium: 2, Low: 3 } as Record<string, number>)[priority];
    expect(value).toBeTruthy();
    const out = Drush.exec(`php:eval '$t = current(\\Drupal::entityTypeManager()->getStorage("bb_ticket")->loadByProperties(["identifier" => "${identifier.replace(/[^A-Z0-9-]/g, '')}"])); $t->set("priority", ${value}); $t->save(); print $t->get("priority")->value;'`).trim();
    expect(out.split('\n').pop()).toBe(String(value));
});

When('another editor sets the reviewers of {string} to {string}', async ({}, identifier: string, names: string) => {
    const accounts = names.split(', ').map(name =>
        `current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${name.replace(/[^a-z0-9_-]/gi, '')}"]))->id()`);
    const out = Drush.exec(`php:eval '$t = current(\\Drupal::entityTypeManager()->getStorage("bb_ticket")->loadByProperties(["identifier" => "${identifier.replace(/[^A-Z0-9-]/g, '')}"])); $t->set("reviewers", [${accounts.join(', ')}]); $t->save(); print count($t->get("reviewers"));'`).trim();
    expect(out.split('\n').pop()).toBe(String(accounts.length));
});
