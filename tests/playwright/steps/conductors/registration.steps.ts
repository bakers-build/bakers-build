import { createBdd } from 'playwright-bdd';
import { Drush } from '@key-tec/playwright-core';
import { test, expect } from '../../bdd.fixtures';

const { Given, When, Then } = createBdd(test);

Then('authenticated accounts receive no implicit bakers.build capability', async () => {
    const permissions: string[] = JSON.parse(Drush.exec('php:eval \'print json_encode(\\Drupal\\user\\Entity\\Role::load("authenticated")->getPermissions());\'').trim());
    expect(permissions.filter(permission => permission.includes('bakers'))).toEqual([]);
});

Then('conductor assignment declares no separate permission', async () => {
    const declared = JSON.parse(Drush.exec('php:eval \'print json_encode(array_key_exists("assign bakers conductor", \\Drupal::service("user.permissions")->getPermissions()));\'').trim());
    expect(declared).toBe(false);
});
