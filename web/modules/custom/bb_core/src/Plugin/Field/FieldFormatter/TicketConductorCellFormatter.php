<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The conductor column: a machine's LEASE on the record.
 *
 * A machine's hold on the ticket, so the cell is the claim badge: `tone:
 * lease`, `mono`, and a `lock` icon. `mine` is TRUE when the ticket's assignee
 * is the reader, not when the reader owns the conductor: the reader's stake is
 * being assigned the ticket.
 */
#[FieldFormatter(
  id: 'bb_ticket_conductor_cell',
  label: new TranslatableMarkup('Table cell: lease badge'),
  description: new TranslatableMarkup("The referenced conductor as a lease badge, outlined when the record is the reader's own."),
  field_types: ['entity_reference'],
)]
final class TicketConductorCellFormatter extends TicketReferenceCellFormatterBase {

  /**
   * The reader, whose own leases are outlined.
   */
  private AccountInterface $currentUser;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = new static(
      $plugin_id,
      $plugin_definition,
      $configuration['field_definition'],
      $configuration['settings'],
      $configuration['label'],
      $configuration['view_mode'],
      $configuration['third_party_settings'],
    );
    $instance->currentUser = $container->get('current_user');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $mine = $this->isTheReaders($items);

    $elements = [];
    foreach ($this->getEntitiesToView($items, $langcode) as $delta => $entity) {
      $elements[$delta] = $this->cellElement([
        'kind' => 'badge',
        'label' => (string) $entity->label(),
        'tone' => 'lease',
        'mono' => TRUE,
        'icon' => 'lock',
        'mine' => $mine,
      ]);
    }
    return $elements;
  }

  /**
   * Whether the record this cell belongs to is assigned to the reader.
   *
   * @param \Drupal\Core\Field\FieldItemListInterface $items
   *   The conductor field, whose entity is the record.
   *
   * @return bool
   *   TRUE when the record's assignee is the current account.
   */
  private function isTheReaders(FieldItemListInterface $items): bool {
    $entity = $items->getEntity();
    if (!$entity->hasField('assignee_user_id')) {
      return FALSE;
    }
    $assignee = $entity->get('assignee_user_id')->target_id;
    if ($assignee === NULL || $this->currentUser->isAnonymous()) {
      return FALSE;
    }
    return (string) $assignee === (string) $this->currentUser->id();
  }

}
