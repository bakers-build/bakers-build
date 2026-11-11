<?php

/**
 * @file
 * Post update functions for bb_core.
 */

declare(strict_types=1);

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\BranchName;

/**
 * Removes the environments past deploys stamped onto the tickets they carried.
 *
 * A deployment ticket is now the only record of where its batch is deployed.
 * From every non-deployment ticket a deployment references, the environments
 * that deployment lists are removed; other environments stay.
 */
function bb_core_post_update_clear_deployment_stamps(array &$sandbox): string {
  $storage = \Drupal::entityTypeManager()->getStorage('bb_ticket');
  if (!isset($sandbox['ids'])) {
    $sandbox['ids'] = array_values($storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_type.entity.name', 'deployment')
      ->exists('referenced_tickets')
      ->sort('id')
      ->execute());
    $sandbox['total'] = count($sandbox['ids']);
    $sandbox['changed'] = 0;
  }
  foreach ($storage->loadMultiple(array_splice($sandbox['ids'], 0, 25)) as $deployment) {
    assert($deployment instanceof BbTicketInterface);
    $stamped = array_column($deployment->get('environments')->getValue(), 'target_id');
    foreach ($deployment->get('referenced_tickets')->referencedEntities() as $ticket) {
      assert($ticket instanceof BbTicketInterface);
      if (mb_strtolower((string) $ticket->get('ticket_type')->entity?->label()) === 'deployment') {
        continue;
      }
      $items = $ticket->get('environments')->getValue();
      $kept = array_values(array_filter($items, static fn (array $item): bool => !in_array($item['target_id'], $stamped)));
      if (count($kept) !== count($items)) {
        $ticket->set('environments', $kept)->save();
        $sandbox['changed']++;
      }
    }
  }
  $sandbox['#finished'] = $sandbox['total'] ? 1 - count($sandbox['ids']) / $sandbox['total'] : 1;
  return (string) t('Removed deployment environments from @count tickets.', ['@count' => $sandbox['changed']]);
}

/**
 * Repairs stored branch names git would refuse.
 *
 * Covers tickets' `branch_name` and repositories' `default_branch` saved
 * before both were validated. Names matching BranchName::PATTERN stay as they
 * are. Every other name is rewritten; git refuses nearly all of them, but a
 * non-ASCII name git would hold loses its link to that branch.
 */
function bb_core_post_update_valid_branch_names(): string {
  $database = \Drupal::database();
  $repaired = 0;
  foreach (['bb_ticket' => 'branch_name', 'bb_project' => 'repository__default_branch'] as $table => $column) {
    $rows = $database->select($table, 't')->fields('t', ['id', $column])->isNotNull($column)->execute()->fetchAllKeyed();
    foreach ($rows as $id => $value) {
      if ($value === '' || preg_match(BranchName::PATTERN, (string) $value)) {
        continue;
      }
      $database->update($table)
        ->fields([$column => BranchName::sanitize((string) $value) ?: NULL])
        ->condition('id', $id)
        ->execute();
      $repaired++;
    }
  }
  \Drupal::entityTypeManager()->getStorage('bb_ticket')->resetCache();
  \Drupal::entityTypeManager()->getStorage('bb_project')->resetCache();
  return sprintf('Repaired %d branch names git would refuse.', $repaired);
}

/**
 * Installs the optional connection address without changing existing machines.
 */
function bb_core_post_update_machine_connection_url(): void {
  $manager = \Drupal::entityDefinitionUpdateManager();
  if ($manager->getFieldStorageDefinition('connection_url', 'bb_machine') === NULL) {
    $definition = \Drupal::service('entity_field.manager')->getFieldStorageDefinitions('bb_machine')['connection_url'];
    $manager->installFieldStorageDefinition('connection_url', 'bb_machine', 'bb_core', $definition);
  }
}

/**
 * Installs the ticket restart stamp without changing existing tickets.
 */
function bb_core_post_update_ticket_restart_fields(): void {
  $manager = \Drupal::entityDefinitionUpdateManager();
  $definitions = \Drupal::service('entity_field.manager')->getFieldStorageDefinitions('bb_ticket');
  foreach (['restarted_at', 'restarted_by'] as $name) {
    if ($manager->getFieldStorageDefinition($name, 'bb_ticket') === NULL) {
      $manager->installFieldStorageDefinition($name, 'bb_ticket', 'bb_core', $definitions[$name]);
    }
  }
}
