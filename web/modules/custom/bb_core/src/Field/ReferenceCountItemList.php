<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Cache\CacheableDependencyInterface;
use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;

/**
 * How many entities reference this one, as the reader may see them.
 *
 * The counted entity type, its reference field and extra conditions are
 * named per field in COUNTS (see ReferenceCounter::count()). A listing row
 * shows the number with the `bb_integer_badge` formatter.
 */
final class ReferenceCountItemList extends FieldItemList implements CacheableDependencyInterface {

  use ComputedItemListTrait;

  /**
   * Counted entity type, reference field and conditions per host field.
   */
  public const array COUNTS = [
    'bb_group.projects' => ['bb_project', 'group_id', []],
    'bb_project.open_tickets' => ['bb_ticket', 'project_id', ['closed' => 0]],
    'bb_project.conductor_tickets' => [
      'bb_ticket',
      'project_id',
      ['closed' => 0, 'conductor_id' => ['operator' => 'IS NOT NULL']],
    ],
    'bb_project.closed_tickets' => ['bb_ticket', 'project_id', ['closed' => 1]],
  ];

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $entity = $this->getEntity();
    if ($entity->isNew()) {
      return;
    }
    [$type, $field, $conditions] = $this->countDefinition();
    // shortcut: one query per row, as UI Patterns renders each row's field on
    // its own; batch through ReferenceCounter when a listing gets slow.
    $counts = \Drupal::service('bb_core.reference_counter')->count($type, $field, [$entity->id()], $conditions);
    $this->list[0] = $this->createItem(0, $counts[$entity->id()] ?? 0);
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheContexts(): array {
    // Counts run with access checks: the number is the reader's own.
    return ['user'];
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheTags(): array {
    // Any counted entity saved anywhere must recount.
    return array_values(\Drupal::entityTypeManager()->getDefinition($this->countDefinition()[0])->getListCacheTags());
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheMaxAge(): int {
    return -1;
  }

  /**
   * This field's count definition.
   *
   * @return array{string, string, array<string, mixed>}
   *   Counted entity type, reference field and conditions.
   */
  private function countDefinition(): array {
    return self::COUNTS[$this->getEntity()->getEntityTypeId() . '.' . $this->getName()];
  }

}
