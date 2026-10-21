<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * The person cell for who created the item; nothing when nobody did.
 *
 * "Unassigned" names an actionable absence, which a missing creator is not.
 */
#[FieldFormatter(
  id: 'bb_ticket_owner_cell',
  label: new TranslatableMarkup('Table cell: creator'),
  description: new TranslatableMarkup('The referenced account as a person cell; empty when there is none.'),
  field_types: ['entity_reference'],
)]
final class TicketOwnerCellFormatter extends TicketAssigneeCellFormatter {

  protected const PLACEHOLDER = FALSE;

}
