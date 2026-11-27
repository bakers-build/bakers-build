<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Claim\TicketStallReason;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Why a ticket stands still, as a badge; nothing while it moves.
 */
#[FieldFormatter(
  id: 'bb_stall_reason',
  label: new TranslatableMarkup('Stall reason badge'),
  field_types: ['string'],
)]
final class BbStallReasonFormatter extends FormatterBase {

  /**
   * {@inheritdoc}
   *
   * @return array<int, array<string, mixed>>
   *   A stall badge, or nothing when the ticket is moving.
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $ticket = $items->getEntity();
    $reason = (string) $items->value;
    if (!$ticket instanceof BbTicketInterface || $reason === '') {
      return [];
    }
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:badge',
      '#props' => TicketStallReason::badge($reason, $ticket->getFrozenAt()),
    ];
    TicketStallReason::cacheability($ticket)->addCacheContexts(['user'])->applyTo($build);
    return [0 => $build];
  }

}
