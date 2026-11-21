<?php

declare(strict_types=1);

namespace Drupal\bb_track\Inspector;

use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Inspector\InspectorRows;
use Drupal\bb_track\Entity\Account;

/**
 * A billing account detail's properties: its state, terms and tickets.
 *
 * The terms and the external ID follow the account's field access, so a
 * reader who may not edit the project gets none of them.
 */
final class AccountInspectorRows extends InspectorRows {

  /**
   * Inspector fields in display order, keyed by field name.
   */
  public const array FIELDS = [
    'billing_type' => 'Type',
    'budget_kind' => 'Budget',
    'budget_value' => 'Budget value',
    'fixed_fee' => 'Fixed fee',
    'hourly_rate' => 'Hourly rate',
    'external_id' => 'External ID',
  ];

  /**
   * {@inheritdoc}
   */
  protected bool $omitEmpty = TRUE;

  /**
   * Builds the rail's `items` array.
   *
   * @return array<string, array<string, mixed>>
   *   List items keyed by row.
   */
  public function build(Account $billing_account): array {
    $state = match (TRUE) {
      !$billing_account->get('active')->value => $this->badge('Archived', 'offline'),
      (bool) $billing_account->get('is_default')->value => $this->badge('Default', 'running'),
      default => $this->badge('Active'),
    };
    $tickets = [];
    foreach ($billing_account->get('tickets')->referencedEntities() as $ticket) {
      if ($ticket instanceof BbTicketInterface && $ticket->access('view')) {
        $tickets[] = $ticket->getIdentifier();
      }
    }
    return ['state' => $this->row('State', $state)]
      + $this->buildRows($billing_account, self::FIELDS)
      + ['tickets' => $this->row('Tickets', $this->text(implode(', ', $tickets)))];
  }

  /**
   * {@inheritdoc}
   */
  protected function fieldRow(FieldableEntityInterface $entity, string $field, string $label): array {
    $value = (string) $entity->get($field)->value;
    $options = $entity->get($field)->getSetting('allowed_values') ?? [];
    return $this->row($label, $field === 'external_id' ? $this->mono($value) : $this->text((string) ($options[$value] ?? $value)));
  }

}
