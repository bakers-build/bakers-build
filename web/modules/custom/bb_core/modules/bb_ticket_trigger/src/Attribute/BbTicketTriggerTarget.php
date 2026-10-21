<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Attribute;

use Drupal\Component\Plugin\Attribute\AttributeBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Defines a ticket trigger target plugin, a bundle of `bb_ticket_trigger`.
 *
 * @see \Drupal\bb_ticket_trigger\TicketTrigger\BbTicketTriggerTargetInterface
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
final class BbTicketTriggerTarget extends AttributeBase {

  /**
   * Constructs a BbTicketTriggerTarget attribute.
   *
   * @param string $id
   *   The plugin ID, which is also the bundle.
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $label
   *   The human-readable label.
   * @param string $target_entity_type
   *   The entity type the trigger acts on.
   * @param string $target_field
   *   The bundle field referencing the target; unique across bundles.
   */
  public function __construct(
    public readonly string $id,
    public readonly TranslatableMarkup $label,
    public readonly string $target_entity_type,
    public readonly string $target_field,
  ) {}

}
