<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger_test\Plugin\BbTicketTriggerType;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_ticket_trigger\Attribute\BbTicketTriggerType;
use Drupal\bb_ticket_trigger\TicketTrigger\TicketTriggerTypeBase;

/**
 * An event-driven fixture type: fired by its caller, never by cron.
 */
#[BbTicketTriggerType(
  id: 'test_event',
  label: new TranslatableMarkup('Test event'),
  scheduled: FALSE,
)]
final class TestEvent extends TicketTriggerTypeBase {

  /**
   * {@inheritdoc}
   */
  public function summary(): string {
    return 'On test event';
  }

}
