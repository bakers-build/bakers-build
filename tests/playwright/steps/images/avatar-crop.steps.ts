// The square crop dialog of an image upload, operated through its visible
// controls only. The avatar is read back as decoded pixels of the rendered
// <img>, so a URL that merely names the image style proves nothing here.
import { Given, When, Then, test } from '@key-tec/playwright-core/bdd';
import { createBdd } from 'playwright-bdd';
import { Drush } from '@key-tec/playwright-core';
import { expect, type Locator, type Page } from '@playwright/test';
import { RAIL_ISLAND } from '../../support/shell';
import { php } from '../../support/drush';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Crop image' });
const viewport = (page: Page) => dialog(page).getByRole('img', { name: 'Image to crop' });

function cropImageLeft(page: Page): Promise<string> {
  return viewport(page).locator('img').evaluate((el) => (el as HTMLElement).style.left);
}

const moved = new WeakMap<Page, string>();
const { After } = createBdd(test);

const alpineBundle = (page: Page) => page.locator('script[type="module"][src*="/dist/js/alpine.js"]');
const bundleAddress = new WeakMap<Page, string>();
const pageErrors = new WeakMap<Page, string[]>();
let aggregationChanged = false;

function setJsAggregation(enabled: boolean): void {
  php(`\\Drupal::configFactory()->getEditable("system.performance")->set("js.preprocess", ${enabled ? 'TRUE' : 'FALSE'})->save();`);
  Drush.exec('cr');
}

Given('JavaScript aggregation is {word}', async ({}, state: string) => {
  aggregationChanged = true;
  setJsAggregation(state === 'enabled');
});

// The recipe-test world runs with aggregation on; restore it for the next scenario.
After({ tags: '@feature:avatar-crop' }, async () => {
  if (aggregationChanged) {
    aggregationChanged = false;
    setJsAggregation(true);
  }
});

When('I note the address of the Alpine bundle', async ({ page }) => {
  const collected: string[] = [];
  pageErrors.set(page, collected);
  page.on('pageerror', (error) => collected.push(error.message));
  await expect(alpineBundle(page)).toHaveCount(1);
  bundleAddress.set(page, (await alpineBundle(page).getAttribute('src')) ?? '');
});

// `drush deploy` ends with the same full cache rebuild.
When('the caches are rebuilt as a deployment does', async () => {
  Drush.exec('cr');
});

Then('the address of the Alpine bundle has changed', async ({ page }) => {
  await expect(alpineBundle(page)).toHaveCount(1);
  expect(await alpineBundle(page).getAttribute('src')).not.toBe(bundleAddress.get(page));
});

Then('the page reported no error', async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

Given('the account {string} has no profile picture', async ({}, name: string) => {
  Drush.exec(
    `ev '$u = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${name}"])); ` +
      '$u->set("user_picture", NULL); $u->save();\'',
  );
});

When('I choose the profile picture {string}', async ({ page }, fixture: string) => {
  await page.getByLabel('Profile picture', { exact: true }).setInputFiles(`fixtures/${fixture}`);
  await expect(dialog(page)).toBeVisible();
});

Then('the crop dialog is open', async ({ page }) => {
  await expect(dialog(page)).toBeVisible();
  const box = await viewport(page).boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(50);
});

Then('the crop dialog is closed', async ({ page }) => {
  await expect(dialog(page)).toBeHidden();
});

When('I drag the image in the crop dialog {int} pixels to the {word}', async ({ page }, distance: number, direction: string) => {
  const box = await viewport(page).boundingBox();
  if (!box) {
    throw new Error('The crop viewport is not rendered.');
  }
  moved.set(page, await cropImageLeft(page));
  const [dx, dy] = { left: [-distance, 0], right: [distance, 0], up: [0, -distance], down: [0, distance] }[direction] ?? [0, 0];
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 10 });
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
});

Then('the image in the crop dialog has moved', async ({ page }) => {
  expect(await cropImageLeft(page)).not.toBe(moved.get(page));
});

When('I zoom the crop in fully with the keyboard', async ({ page }) => {
  const zoom = dialog(page).getByRole('slider', { name: 'Zoom' });
  await zoom.focus();
  await page.keyboard.press('End');
  await expect(zoom).toHaveValue('4');
});

When('I press the arrow key {string} {int} times in the crop dialog', async ({ page }, key: string, times: number) => {
  await viewport(page).focus();
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
  }
});

When('I apply the crop', async ({ page }) => {
  await dialog(page).getByRole('button', { name: 'Apply' }).click();
  await expect(dialog(page)).toBeHidden();
});

When('I reset the crop', async ({ page }) => {
  await dialog(page).getByRole('button', { name: 'Reset' }).click();
});

When('I remove the profile picture', async ({ page }) => {
  const navigation = page.waitForNavigation({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await navigation;
});

When('I apply the crop with the keyboard', async ({ page }) => {
  await dialog(page).getByRole('button', { name: 'Apply' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeHidden();
});

When('I press Escape in the crop dialog', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
});

Then('focus is back on the crop button', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Edit crop' })).toBeFocused();
});

When('I edit the crop of the profile picture', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit crop' }).click();
  await expect(dialog(page)).toBeVisible();
});

When('I change my nickname to {string}', async ({ page }, name: string) => {
  await page.getByLabel('Username', { exact: true }).fill(name);
});

Then('the profile form shows no error', async ({ page }) => {
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('main [aria-invalid="true"]')).toHaveCount(0);
});

Then('the nickname is marked invalid', async ({ page }) => {
  await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toHaveAttribute('aria-invalid', 'true');
});

Then('the crop dialog fits within the viewport', async ({ page }) => {
  const box = await dialog(page).boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
});

/** Names the colour at the centre of an avatar, by default the account overview's. */
export async function avatarColour(page: Page, mark: Locator = page.locator('main img[data-person-mark]').first()): Promise<string> {
  await expect(mark).toBeVisible();
  const [r, g, b] = await mark.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    return Array.from(context.getImageData(img.naturalWidth / 2, img.naturalHeight / 2, 1, 1).data);
  });
  return r > 180 && g < 90 && b < 90 ? 'red'
    : r > 200 && g > 180 && b < 120 ? 'yellow'
    : b > 150 && r < 90 ? 'blue'
    : Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && r > 180 ? 'grey'
    : `rgb(${r}, ${g}, ${b})`;
}

Then('my avatar shows my initials', async ({ page }) => {
  await expect(page.locator('main [data-person-mark]').first()).toBeVisible();
  await expect(page.locator('main img[data-person-mark]')).toHaveCount(0);
});

Then('my avatar shows {string}', async ({ page }, expected: string) => {
  expect(await avatarColour(page)).toBe(expected);
});

Then('the rail shows my avatar as {string}', async ({ page }, expected: string) => {
  expect(await avatarColour(page, page.locator(RAIL_ISLAND).locator('img[data-person-mark]').first())).toBe(expected);
});

Then('the account {string} has an avatar showing {string}', async ({ page }, address: string, expected: string) => {
  const uid = Drush.exec(
    `ev '$a = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["mail" => "${address}"])); print $a ? $a->id() : "";'`,
  ).trim();
  await page.goto(`/user/${uid}`);
  expect(await avatarColour(page)).toBe(expected);
});
