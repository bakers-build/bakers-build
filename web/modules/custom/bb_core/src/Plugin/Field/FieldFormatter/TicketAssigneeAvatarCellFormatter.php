<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * The person cell as its mark alone; the name is the tooltip.
 *
 * For a list row's right-hand assignee, where the name would crowd the row.
 */
#[FieldFormatter(
  id: 'bb_ticket_assignee_avatar_cell',
  label: new TranslatableMarkup('Table cell: person mark'),
  description: new TranslatableMarkup('The referenced account as its mark only, named by a tooltip; a placeholder mark when there is none.'),
  field_types: ['entity_reference'],
)]
final class TicketAssigneeAvatarCellFormatter extends TicketAssigneeCellFormatter {

  protected const NAME_HIDDEN = TRUE;

}
