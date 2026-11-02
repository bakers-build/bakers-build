<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\views\field;

use Drupal\bb_core\Time\BbDate;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;

/**
 * The next due occurrence as the product time, or "—".
 */
#[ViewsField('bb_ticket_trigger_next_run')]
final class BbTicketTriggerNextRun extends FieldPluginBase {

  /**
   * {@inheritdoc}
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   */
  public function render(ResultRow $values): string|array {
    $trigger = $this->getEntity($values);
    $next = $trigger instanceof BbTicketTriggerInterface ? $trigger->getNextRun() : NULL;
    if ($next === NULL) {
      return '—';
    }
    return \Drupal::service(BbDate::class)->time($next);
  }

}
