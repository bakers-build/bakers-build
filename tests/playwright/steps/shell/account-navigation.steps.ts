import { Then } from '@key-tec/playwright-core/bdd';
import { expect, type Page } from '@playwright/test';
import { php } from '../../support/drush';
import { documentWasKept, markDocument, PAGE_HEADER_ISLAND, RAIL_ISLAND, uidOf } from '../../support/shell';

const rail = (page: Page) => page.locator(RAIL_ISLAND);
const action = (page: Page, name: string) => page.getByRole('link', { name, exact: true });

function workspaceUuid(slug: string): string {
  if (!/^[a-z]+$/.test(slug)) throw new Error('Expected a fixture workspace slug.');
  return php(`print current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"]))->uuid();`);
}

async function profileFrom(page: Page, slug: string): Promise<string> {
  await page.goto(`/${slug}/tickets`);
  const profile = rail(page).locator('a[href*="/user/"]').filter({ has: page.locator('[data-person-mark]') });
  await expect(profile).toHaveCount(1);
  await expect(profile).toHaveAttribute('href', new RegExp(`workspace=${workspaceUuid(slug)}`));
  await profile.click();
  await expect(action(page, 'Back to workspace')).toHaveAttribute('href', `/${slug}/tickets`);
  return page.url();
}

async function fullPageAction(page: Page, name: string, path: string): Promise<void> {
  const link = action(page, name);
  await expect(link).toHaveAttribute('href', path);
  await expect(link).toHaveAttribute('data-hx-boost', 'false');
  await markDocument(page);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
  expect(await documentWasKept(page)).toBe(false);
}

Then('logout works from my account rail in {string}', async ({ page }, slug: string) => {
  const account = slug === 'other' ? 'south-contributor' : 'both-bakeries';
  const uid = uidOf(account);
  await page.goto(`/${slug}/tickets`);
  await expect(action(page, 'Log out')).toHaveCount(0);
  await expect(action(page, 'Workspace overview')).toHaveCount(0);
  const profile = await profileFrom(page, slug);
  const paths = [profile, `/user/${uid}/edit?workspace=${workspaceUuid(slug)}`];
  if (slug === 'other') paths.push(`/user/${uid}/conductors`, `/user/${uid}/machines`);
  for (const path of paths) {
    await page.goto(path);
    const logout = rail(page).getByRole('link', { name: 'Log out', exact: true });
    await expect(logout).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Log out', exact: true })).toHaveCount(0);
    const workspaces = action(page, 'Workspaces');
    await expect(workspaces).toHaveAttribute('href', '/home');
    await expect(workspaces).toHaveAttribute('data-hx-boost', 'false');
    const lastLinks = rail(page).getByRole('navigation').getByRole('link');
    await expect(lastLinks.nth(-2)).toHaveText('Workspaces');
    const machines = rail(page).getByRole('link', { name: 'Machines', exact: true });
    await expect(rail(page).getByRole('navigation').getByRole('link').last()).toHaveText('Log out');
    if (slug === 'other') {
      await expect(machines).toBeVisible();
    } else {
      await expect(machines).toHaveCount(0);
    }
  }
  for (let visit = 0; visit < 2; visit++) {
    await fullPageAction(page, 'Workspaces', '/home');
    await page.goto(profile);
  }
  await fullPageAction(page, 'Log out', '/user/logout/confirm');
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await page.goto(profile);
  await fullPageAction(page, 'Log out', '/user/logout/confirm');
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  const protectedResponse = await page.goto(`/${slug}/tickets`);
  expect(protectedResponse?.status()).toBe(404);
  await expect(rail(page)).toHaveCount(0);
});

Then('workspace settings expose the overview outside the menu', async ({ page }) => {
  await page.goto('/bakers/settings');
  await expect(rail(page).getByRole('link', { name: 'Workspace overview', exact: true })).toHaveCount(0);
  await expect(page.locator('form').getByRole('link', { name: 'Workspace overview', exact: true })).toBeVisible();
  await fullPageAction(page, 'Workspace overview', '/home');
  await page.goto('/bakers/settings');
  await page.setViewportSize({ width: 320, height: 740 });
  const overview = action(page, 'Workspace overview');
  await overview.focus();
  await expect(overview).toBeFocused();
  await overview.press('Enter');
  await expect(page).toHaveURL(/\/home$/);
  await page.goto(`/user/${uidOf('both-bakeries')}`);
  await expect(action(page, 'Log out')).toHaveCount(0);
});

Then('my profile retains the {string} origin through tabs and saving', async ({ page }, slug: string) => {
  await profileFrom(page, slug);
  const origin = workspaceUuid(slug);
  const uid = uidOf('both-bakeries');
  for (const tab of ['Edit', 'View', 'Edit']) {
    await page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: tab, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/user/${uid}${tab === 'Edit' ? '/edit' : ''}\\?workspace=${origin}$`));
    await expect(action(page, 'Back to workspace')).toHaveAttribute('href', `/${slug}/tickets`);
  }
  const username = page.getByRole('textbox', { name: 'Username', exact: true });
  const original = await username.inputValue();
  await username.fill('');
  await page.locator('form.user-form').evaluate((form: HTMLFormElement) => { form.noValidate = true; });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`workspace=${origin}`));
  await expect(username).toHaveAttribute('aria-invalid', 'true');
  await username.fill(original);
  const [saved] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes(`/user/${uid}/edit`)),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  expect(saved.status()).toBe(303);
  await expect(username).not.toHaveAttribute('aria-invalid', 'true');
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`workspace=${origin}`));
  await fullPageAction(page, 'Back to workspace', `/${slug}/tickets`);
});

Then('two profile tabs return to their own workspaces', async ({ page }) => {
  await profileFrom(page, 'bakers');
  const second = await page.context().newPage();
  try {
    await profileFrom(second, 'other');
    await page.reload();
    await fullPageAction(page, 'Back to workspace', '/bakers/tickets');
    await fullPageAction(second, 'Back to workspace', '/other/tickets');
  } finally {
    await second.close();
  }
});

Then('invalid account origins expose no workspace navigation', async ({ page }) => {
  const uid = uidOf('south-contributor');
  for (const suffix of ['', '?workspace=bad', '?workspace[]=bad', '?workspace=https://example.com', '?workspace=00000000-0000-4000-8000-000000000001', `?workspace=${workspaceUuid('bakers')}`]) {
    for (const path of [`/user/${uid}`, `/user/${uid}/edit`]) {
      await page.goto(path + suffix);
      await expect(action(page, 'Back to workspace')).toHaveCount(0);
      await expect(action(page, 'My work')).toHaveCount(0);
      await expect(action(page, 'Workspace overview')).toHaveCount(0);
      await expect(action(page, 'Log out')).toHaveCount(1);
      await expect(rail(page).locator('[data-account-switcher]').getByText('Workspaces', { exact: true })).toBeVisible();
    }
  }
});

Then('revoking my membership removes the cached workspace return', async ({ page }) => {
  const profile = await profileFrom(page, 'other');
  await page.reload();
  await expect(action(page, 'Back to workspace')).toBeVisible();
  const membership = '$membership = \\Drupal::service("entity.repository")->loadEntityByUuid("og_membership", "dbd10000-0000-4000-8000-000000000009");';
  const original = php(`${membership} print $membership->getState();`);
  expect(original).toBe('active');
  try {
    php(`${membership} $membership->setState("blocked")->save();`);
    for (const path of [profile, profile.replace('?', '/edit?')]) {
      await page.goto(path);
      await expect(action(page, 'Back to workspace')).toHaveCount(0);
      await expect(action(page, 'My work')).toHaveCount(0);
      await expect(rail(page).locator('[data-account-switcher]').getByText('Workspaces', { exact: true })).toBeVisible();
    }
    await expect(action(page, 'Log out')).toBeVisible();
  } finally {
    php(`${membership} $membership->setState("active")->save();`);
  }
  await page.goto(profile);
  await fullPageAction(page, 'Back to workspace', '/other/tickets');
});

Then('account actions work with the keyboard at 320 pixels', async ({ page }) => {
  await profileFrom(page, 'other');
  await page.setViewportSize({ width: 320, height: 740 });
  const toggle = rail(page).locator('[data-sidebar-toggle]');
  if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
  for (const name of ['Back to workspace', 'Workspaces', 'Log out']) {
    const link = action(page, name);
    await expect(link).toBeVisible();
    await link.focus();
    await expect(link).toBeFocused();
    const box = await link.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  }
  await page.setViewportSize({ width: 320, height: 260 });
  await action(page, 'Workspaces').scrollIntoViewIfNeeded();
  await action(page, 'Workspaces').focus();
  await expect(action(page, 'Workspaces')).toBeFocused();
  await action(page, 'Log out').scrollIntoViewIfNeeded();
  await action(page, 'Log out').press('Enter');
  await expect(page).toHaveURL(/\/user\/logout\/confirm$/);
});
