<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Attribute;

use Drupal\Component\Plugin\Attribute\AttributeBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Defines a ticket trigger type plugin.
 *
 * @see \Drupal\bb_ticket_trigger\TicketTrigger\BbTicketTriggerTypeInterface
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
final class BbTicketTriggerType extends AttributeBase {

  /**
   * Constructs a BbTicketTriggerType attribute.
   *
   * @param string $id
   *   The plugin ID.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $label
   *   The human-readable label.
   * @param bool $scheduled
   *   TRUE when cron fires the trigger from nextOccurrence(); FALSE when the
   *   type's own code fires it through TicketTriggerRunner::fire().
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public function __construct(
    public readonly string $id,
    public readonly TranslatableMarkup $label,
    public readonly bool $scheduled = TRUE,
  ) {}

}
