<?php

/**
 * @file
 * Creates a playground ticket and hands it to the playground conductor.
 *
 * Run inside the control plane, from a sandboxed run as
 * `ddev_exec("drush php:script scripts/e2e/playground-ticket.php --
 * <conductor_id> <title> [<state>]")`; `.bakers/scripts/conductor-e2e.sh` prints the
 * line with the conductor_id filled in. The ticket is a `bb_work` chore with
 * recipe `matt` in the conductor's project, default state `working`. Prints
 * the ticket identifier. Teardown purges it with the conductor's other work.
 */

declare(strict_types=1);

use Drupal\bb_core\Entity\BbTicketInterface;

[$conductorId, $title, $state] = array_pad(array_slice($extra ?? [], 0, 3), 3, NULL);
if (!$conductorId || !$title) {
  throw new \InvalidArgumentException('usage: drush php:script scripts/e2e/playground-ticket.php -- <conductor_id> <title> [<state>]');
}

$etm = \Drupal::entityTypeManager();
$conductors = $etm->getStorage('bb_conductor')->loadByProperties(['conductor_id' => $conductorId]);
$conductor = reset($conductors) ?: throw new \RuntimeException("no bb_conductor with conductor_id '$conductorId'; start it with provision_up('conductor-e2e')");
$project = $conductor->get('project_id')->entity ?? throw new \RuntimeException("conductor '$conductorId' has no project");
$workspace = $project->getGroup()?->getWorkspace() ?? throw new \RuntimeException("conductor '$conductorId' has a project without a workspace");

// As bakers_ticket_create does: the workspace's term of that name, created when missing.
$term = function (string $vid, string $name) use ($etm, $workspace): int|string {
  $storage = $etm->getStorage('bb_term');
  $found = $storage->loadByProperties(['vid' => $vid, 'name' => $name, 'workspace_id' => $workspace->id()]);
  $term = reset($found) ?: $storage->create(['vid' => $vid, 'name' => $name, 'workspace_id' => $workspace->id()]);
  if ($term->isNew()) {
    $term->save();
  }
  return $term->id();
};

$ticket = $etm->getStorage('bb_ticket')->create([
  'title' => $title,
  'workflow' => 'bb_work',
  'ticket_type' => $term('type', 'chore'),
  'recipe' => $term('recipe', 'matt'),
  'project_id' => $project->id(),
  'owner_user_id' => $conductor->get('owner_user_id')->target_id,
  'conductor_id' => $conductor->id(),
]);
assert($ticket instanceof BbTicketInterface);
$ticket->save();
$ticket->set('state', $state ?: 'working')->save();
print $ticket->get('identifier')->value . PHP_EOL;
