<?php

/**
 * @file
 * Post update functions for bb_core.
 */

declare(strict_types=1);

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Profile\Profiles;
use Drupal\bb_core\Entity\BbTerm;
use Drupal\bb_core\Entity\BbTermInterface;
use Drupal\bb_core\Ticket\BranchName;
use Drupal\field\Entity\FieldStorageConfig;

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
 * Installs health fields before any label or ticket backfill can save entities.
 */
function bb_core_post_update_ticket_health_1_fields(): void {
  $manager = \Drupal::entityDefinitionUpdateManager();
  $fields = [
    'bb_term' => ['key'],
    'bb_run' => ['state_changed'],
    'bb_ticket' => ['health', 'health_reason', 'health_moved', 'health_checked'],
  ];
  foreach ($fields as $type => $names) {
    $definitions = \Drupal::service('entity_field.manager')->getFieldStorageDefinitions($type);
    foreach ($names as $name) {
      if ($manager->getFieldStorageDefinition($name, $type) === NULL) {
        $manager->installFieldStorageDefinition($name, $type, 'bb_core', $definitions[$name]);
      }
    }
  }
  // shortcut: old runs use changed until their next state transition.
  \Drupal::database()->update('bb_run')->expression('state_changed', 'changed')->isNull('state_changed')->execute();
}

/**
 * Gives existing labels stable identities in bounded batches.
 */
function bb_core_post_update_ticket_health_2_labels(array &$sandbox): void {
  $storage = \Drupal::entityTypeManager()->getStorage('bb_term');
  $ids = $storage->getQuery()->accessCheck(FALSE)->condition('vid', 'label')
    ->condition('id', $sandbox['last'] ?? 0, '>')->sort('id')->range(0, 100)->execute();
  foreach ($storage->loadMultiple($ids) as $term) {
    if (!$term instanceof BbTermInterface || !$term->get('key')->isEmpty()) {
      continue;
    }
    $key = BbTerm::keyOf((string) $term->label());
    $duplicates = $storage->getQuery()->accessCheck(FALSE)->condition('vid', 'label')
      ->condition('workspace_id', $term->get('workspace_id')->target_id)->condition('key', $key)->execute();
    $term->set('key', $duplicates === [] ? $key : $key . '_' . $term->id())->save();
  }
  $sandbox['last'] = $ids === [] ? ($sandbox['last'] ?? 0) : max($ids);
  $sandbox['#finished'] = $ids === [] ? 1 : 0.5;
}

/**
 * Evaluates all open tickets once, leaving closed tickets without health.
 */
function bb_core_post_update_ticket_health_3_tickets(array &$sandbox): void {
  $storage = \Drupal::entityTypeManager()->getStorage('bb_ticket');
  $ids = $storage->getQuery()->accessCheck(FALSE)->condition('closed', 0)
    ->condition('id', $sandbox['last'] ?? 0, '>')->sort('id')->range(0, 100)->execute();
  $tickets = array_filter($storage->loadMultiple($ids), static fn ($entity): bool => $entity instanceof BbTicketInterface);
  \Drupal::service('bb_core.ticket_health')->refresh($tickets);
  $sandbox['last'] = $ids === [] ? ($sandbox['last'] ?? 0) : max($ids);
  $sandbox['#finished'] = $ids === [] ? 1 : 0.5;
}

/**
 * Existing machines allow assignment; existing conductors defer to them.
 *
 * New machines forbid by default. Existing ones allow, so nothing that works
 * today breaks. bb_core_update_11002() installed the columns.
 */
function bb_core_post_update_conductor_assignment(): void {
  foreach (['bb_machine' => 'allow', 'bb_conductor' => 'machine'] as $type => $value) {
    \Drupal::database()->update($type)->fields(['assignment' => $value])->execute();
  }
  \Drupal::entityTypeManager()->getStorage('bb_machine')->resetCache();
  \Drupal::entityTypeManager()->getStorage('bb_conductor')->resetCache();
}

/**
 * Moves position and background from the account into per-workspace profiles.
 *
 * Every workspace the account belongs to, or a service account is bound to,
 * gets a profile with both values; accounts without either value get none.
 * Values of accounts in no workspace are logged, then both fields are deleted.
 * bb_core_update_11003() installed the profile entity.
 */
function bb_core_post_update_user_profiles(array &$sandbox): string {
  $fields = ['position' => 'field_developer_title', 'background' => 'field_bb_background'];
  $definitions = \Drupal::service('entity_field.manager')->getFieldStorageDefinitions('user');
  $fields = array_filter($fields, static fn (string $field): bool => isset($definitions[$field]));
  if ($fields === []) {
    $sandbox['#finished'] = 1;
    return 'No position or background on accounts; nothing to move.';
  }
  $users = \Drupal::entityTypeManager()->getStorage('user');
  $ids = $users->getQuery()->accessCheck(FALSE)->condition('uid', $sandbox['last'] ?? 0, '>')->sort('uid')->range(0, 100)->execute();
  $messages = [];
  foreach ($users->loadMultiple($ids) as $user) {
    $values = array_map(static fn (string $field): string => trim((string) $user->get($field)->value), $fields);
    if (implode('', $values) === '') {
      continue;
    }
    // Every membership state: a blocked member's profile is kept too.
    $workspaces = \Drupal::database()->select('og_membership', 'm')->fields('m', ['entity_id'])
      ->condition('m.uid', $user->id())->condition('m.entity_type', 'bb_workspace')
      ->execute()->fetchCol();
    if ($user->hasField('bb_service_workspace') && !$user->get('bb_service_workspace')->isEmpty()) {
      $workspaces[] = $user->get('bb_service_workspace')->target_id;
    }
    $workspaces = array_unique(array_map('intval', $workspaces));
    if ($workspaces === []) {
      $line = sprintf('uid %d: position "%s", background "%s"', $user->id(), $values['position'] ?? '', $values['background'] ?? '');
      \Drupal::logger('bb_core')->notice('Profile not moved, the account is in no workspace: @line', ['@line' => $line]);
      $messages[] = 'Not moved, in no workspace: ' . $line . '.';
      continue;
    }
    foreach ($workspaces as $workspace_id) {
      $profile = \Drupal::service(Profiles::class)->forAccount((int) $user->id(), $workspace_id);
      $profile->setPosition($values['position'] ?? '')->setBackground($values['background'] ?? '')->save();
    }
  }
  $sandbox['last'] = $ids === [] ? ($sandbox['last'] ?? 0) : max($ids);
  if ($ids !== []) {
    $sandbox['#finished'] = 0.5;
    return implode(' ', $messages);
  }
  foreach ($fields as $field) {
    FieldStorageConfig::loadByName('user', $field)?->delete();
  }
  $sandbox['#finished'] = 1;
  return trim(implode(' ', $messages) . ' Position and background moved into profiles; the account fields are deleted.');
}

