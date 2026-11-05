// Shared account steps: switching the browser to a named seed account.
// Consumers: features/home, projects, tickets, user.
import { Given } from '../../bdd.fixtures';
import { php } from '../drush';
import { safe } from '../listing';

/**
 * Logs in as a named account, resolved to its uid.
 *
 * The catalog's `I am logged in as {string}` speaks a two-word role vocabulary
 * (Administrator, Anonymous) and cannot express "the account that is a member
 * of only the other workspace" — which is the whole subject of the tenancy
 * scenarios. Cookies are cleared first so this really is a user SWITCH and not
 * a second session layered on the Background's.
 */
Given('I am logged in as the account {string}', async ({ page, authProvider }, name: string) => {
  const uid = php(
    'print (($u = current(\\Drupal::entityTypeManager()->getStorage("user")' +
      `->loadByProperties(["name" => "${safe(name)}"]))) ? $u->id() : "");`,
  );
  if (!uid) {
    throw new Error(`No account named "${name}" exists.`);
  }
  await page.context().clearCookies();
  await authProvider.login(page, uid);
});
