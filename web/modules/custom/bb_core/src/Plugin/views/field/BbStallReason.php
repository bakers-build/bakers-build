<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\field;

use Drupal\bb_core\Claim\TicketStallReason;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;

/**
 * Why a ticket is standing still, as a listing badge.
 *
 * Computed at render time from the ticket entity so freeze, blockers, the
 * conductor assignment and the circuit breaker stay live. Empty reasons
 * omit the cell.
 */
#[ViewsField('bb_stall_reason')]
final class BbStallReason extends FieldPluginBase {

  /**
   * {@inheritdoc}
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>|string
   *   A stall badge, or nothing when the ticket is moving.
   */
  public function render(ResultRow $values) {
    $entity = $this->getEntity($values);
    if (!$entity instanceof BbTicketInterface) {
      return '';
    }
    $reason = (string) $entity->get('stall_reason')->value;
    if ($reason === '') {
      return '';
    }
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:badge',
      '#props' => TicketStallReason::badge($reason, $entity->getFrozenAt()),
    ];
    TicketStallReason::cacheability($entity)->addCacheContexts(['user'])->applyTo($build);
    return $build;
  }

}
