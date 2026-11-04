<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityFieldManagerInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\FieldableEntityInterface;

/**
 * What deleting an entity blocks, deletes with it and detaches from others.
 *
 * Each rule names a referencing entity type and field. A rule whose type or
 * field does not exist on this site (an optional module) is skipped.
 */
final class EntityDeleteRules {

  /**
   * A referencing entity keeps the entity from being deleted.
   */
  public const string BLOCK = 'block';

  /**
   * A referencing entity is deleted with it.
   */
  public const string CASCADE = 'cascade';

  /**
   * The reference is removed from the referencing entity.
   */
  public const string DETACH = 'detach';

  /**
   * Blocks when the field holds only this entity, otherwise detaches.
   */
  private const string SOLE = 'sole';

  /**
   * Rules per deleted entity type: [action, referencing type, field].
   */
  private const array RULES = [
    'bb_ticket' => [
      [self::CASCADE, 'bb_comment', 'ticket_id'],
      [self::CASCADE, 'bb_run', 'ticket_id'],
      [self::CASCADE, 'bb_inbox_message', 'ticket_id'],
      [self::CASCADE, 'bb_activity', 'ticket_id'],
      [self::DETACH, 'bb_ticket', 'parent_id'],
      [self::DETACH, 'bb_ticket', 'blocked_by'],
      [self::DETACH, 'bb_ticket', 'referenced_tickets'],
      [self::DETACH, 'bb_ticket_trigger', 'last_ticket_id'],
      [self::DETACH, 'bb_track_account', 'tickets'],
      [self::DETACH, 'bb_track_worklog', 'ticket_id'],
    ],
    'bb_project' => [
      [self::BLOCK, 'bb_ticket', 'project_id'],
      [self::BLOCK, 'bb_track_worklog', 'project_id'],
      [self::BLOCK, 'bb_track_account', 'project_id'],
      [self::BLOCK, 'bb_conductor', 'project_id'],
      [self::CASCADE, 'bb_environment', 'project_id'],
      // Their triggers follow through TicketTriggerHooks::entityDelete().
      [self::CASCADE, 'bb_ticket_template', 'project_id'],
    ],
    'bb_team' => [
      [self::SOLE, 'bb_project', 'teams'],
      [self::CASCADE, 'bb_invite', 'team_id'],
    ],
    'bb_group' => [
      [self::BLOCK, 'bb_project', 'group_id'],
    ],
    'bb_environment' => [
      [self::DETACH, 'bb_ticket', 'environments'],
    ],
    'bb_comment' => [
      [self::DETACH, 'bb_activity', 'comment_id'],
    ],
    'bb_term' => [
      [self::BLOCK, 'bb_ticket', 'ticket_type'],
      [self::BLOCK, 'bb_ticket', 'recipe'],
      [self::BLOCK, 'bb_ticket_template', 'ticket_type'],
      [self::BLOCK, 'bb_ticket_template', 'recipe'],
      [self::DETACH, 'bb_ticket', 'labels'],
      [self::DETACH, 'bb_ticket_template', 'labels'],
    ],
    'bb_conductor' => [
      [self::DETACH, 'bb_ticket', 'conductor_id'],
      [self::DETACH, 'bb_run', 'conductor_id'],
      [self::DETACH, 'bb_ticket_template', 'conductor_id'],
      [self::DETACH, 'bb_inbox_message', 'conductor_id'],
      [self::DETACH, 'bb_activity', 'conductor_id'],
      [self::DETACH, 'bb_addon', 'conductors'],
    ],
    'bb_machine' => [
      [self::DETACH, 'bb_conductor', 'machine'],
    ],
    // A project needs a group, so the group block covers projects too; OG
    // deletes the memberships of a deleted group itself.
    'bb_workspace' => [
      [self::BLOCK, 'bb_group', 'workspace_id'],
      [self::BLOCK, 'bb_team', 'workspace_id'],
      [self::BLOCK, 'user', 'bb_service_workspace'],
      [self::CASCADE, 'bb_term', 'workspace_id'],
      [self::CASCADE, 'bb_invite', 'workspace_id'],
      [self::CASCADE, 'bb_ticket_trigger', 'workspace_id'],
      [self::CASCADE, 'bb_addon', 'workspace_id'],
      [self::CASCADE, 'bb_ticket_template', 'workspace_id'],
    ],
  ];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly EntityFieldManagerInterface $entityFieldManager,
  ) {}

  /**
   * The entities each action touches when the entity is deleted.
   *
   * @return array<string, list<\Drupal\Core\Entity\ContentEntityInterface>>
   *   Referencing entities keyed by BLOCK, CASCADE and DETACH.
   */
  public function references(EntityInterface $entity): array {
    $found = [self::BLOCK => [], self::CASCADE => [], self::DETACH => []];
    foreach ($this->matches($entity) as [$action, $referencing]) {
      $found[$action][] = $referencing;
    }
    foreach ($found as $action => $entities) {
      $unique = [];
      foreach ($entities as $item) {
        $unique[$item->getEntityTypeId() . ':' . $item->id()] = $item;
      }
      $found[$action] = array_values($unique);
    }
    return $found;
  }

  /**
   * Applies the rules before the entity is deleted.
   *
   * @throws \Drupal\Core\Entity\EntityStorageException
   *   When an entity still blocks the delete.
   */
  public function apply(EntityInterface $entity): void {
    $matches = $this->matches($entity);
    $blockers = array_filter($matches, fn($match) => $match[0] === self::BLOCK);
    if ($blockers !== []) {
      throw new EntityStorageException(sprintf('%s %s is still referenced by %d entities.', $entity->getEntityTypeId(), $entity->id(), count($blockers)));
    }
    foreach ($matches as [$action, $referencing, $field]) {
      if ($action === self::DETACH) {
        $referencing->get($field)->filter(fn($item) => (string) $item->target_id !== (string) $entity->id());
        $referencing->save();
      }
    }
    foreach ($matches as [$action, $referencing]) {
      if ($action === self::CASCADE) {
        $referencing->delete();
      }
    }
  }

  /**
   * Loads every referencing entity per rule.
   *
   * @return list<array{0: string, 1: \Drupal\Core\Entity\ContentEntityInterface, 2: string}>
   *   One [action, referencing entity, field] per reference.
   */
  private function matches(EntityInterface $entity): array {
    $matches = [];
    if ($entity->id() === NULL) {
      return [];
    }
    foreach (self::RULES[$entity->getEntityTypeId()] ?? [] as [$action, $type, $field]) {
      $definition = $this->entityTypeManager->getDefinition($type, FALSE);
      if ($definition === NULL || !$definition->entityClassImplements(FieldableEntityInterface::class)
        || !isset($this->entityFieldManager->getFieldStorageDefinitions($type)[$field])) {
        continue;
      }
      $storage = $this->entityTypeManager->getStorage($type);
      $ids = $storage->getQuery()->accessCheck(FALSE)->condition($field, $entity->id())->execute();
      foreach ($storage->loadMultiple($ids) as $referencing) {
        assert($referencing instanceof ContentEntityInterface);
        if ($type === $entity->getEntityTypeId() && $referencing->id() === $entity->id()) {
          continue;
        }
        $resolved = $action === self::SOLE
          ? (count($referencing->get($field)->getValue()) > 1 ? self::DETACH : self::BLOCK)
          : $action;
        $matches[] = [$resolved, $referencing, $field];
      }
    }
    return $matches;
  }

}
