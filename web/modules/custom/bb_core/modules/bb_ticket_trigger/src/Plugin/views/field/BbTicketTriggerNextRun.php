<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\views\field;

use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;

/**
 * The next due occurrence in the trigger's own zone, or "—".
 *
 * The schedule's zone, not the viewer's: "09:00 (Europe/Berlin)" is what the
 * manager configured.
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
  public function render(ResultRow $values): string {
    $trigger = $this->getEntity($values);
    $next = $trigger instanceof BbTicketTriggerInterface ? $trigger->getNextRun() : NULL;
    if (!$trigger instanceof BbTicketTriggerInterface || $next === NULL) {
      return '—';
    }
    $zone = (string) ($trigger->getTypePlugin()->getConfiguration()['timezone'] ?? 'UTC');
    if (!in_array($zone, \DateTimeZone::listIdentifiers(), TRUE)) {
      $zone = 'UTC';
    }
    return (new \DateTimeImmutable('@' . $next))->setTimezone(new \DateTimeZone($zone))->format('Y-m-d H:i T');
  }

}
