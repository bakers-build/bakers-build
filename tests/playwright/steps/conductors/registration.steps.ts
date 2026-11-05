import { createBdd } from 'playwright-bdd';
import { Drush } from '../../support/drush';
import { test, expect } from '../../bdd.fixtures';

const { Given, When, Then } = createBdd(test);

Then('authenticated accounts receive no implicit bakers.build capability', async () => {
    const permissions: string[] = JSON.parse(Drush.exec('php:eval \'print json_encode(\\Drupal\\user\\Entity\\Role::load("authenticated")->getPermissions());\'').trim());
    // Every account reads its own My work figures; another account's figures
    // still need a rank over that account (FigureDisclosure).
    const ownFigures = ['user_flow', 'user_overview', 'user_projects', 'user_tickets'].map(id => `view bakers figure ${id}`);
    expect(permissions.filter(permission => permission.includes('bakers') && !ownFigures.includes(permission))).toEqual([]);
});

Then('conductor assignment declares no separate permission', async () => {
    const declared = JSON.parse(Drush.exec('php:eval \'print json_encode(array_key_exists("assign bakers conductor", \\Drupal::service("user.permissions")->getPermissions()));\'').trim());
    expect(declared).toBe(false);
});
