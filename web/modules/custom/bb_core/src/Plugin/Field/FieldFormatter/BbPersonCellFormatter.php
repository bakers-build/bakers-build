<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\user\UserInterface;

/**
 * An account's own name column: the person, as the SUBJECT of the row.
 *
 * Unlike TicketAssigneeCellFormatter, the account is the row's subject: there
 * is no absence to name, and the mail is offered so `cell()` derives the
 * `full` identity. The mail is only passed where the reader has `view` access
 * to it; otherwise the cell falls back to the compact identity. It formats
 * `user.name` (reached through a `uid` relationship) so the column sorts by
 * name; an item list whose entity is not a user renders plain text.
 */
#[FieldFormatter(
  id: 'bb_person_cell',
  label: new TranslatableMarkup('Table cell: person (row subject)'),
  description: new TranslatableMarkup("The account the row is about, as a person cell with its mark and — where the reader may see it — its mail."),
  field_types: ['string'],
)]
final class BbPersonCellFormatter extends FormatterBase {

  use PersonIdentityTrait;
  use TicketCellRenderTrait;

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $account = $items->getEntity();
    $elements = [];
    foreach ($items as $delta => $item) {
      $name = (string) $item->get('value')->getValue();
      if ($name === '') {
        continue;
      }
      if (!$account instanceof UserInterface) {
        // A string field on something that is not an account. Plain text is the
        // honest rendering: a mark and a colour would be claims about a person
        // this formatter has not been given.
        $elements[$delta] = $this->cellElement(['kind' => 'text', 'value' => $name]);
        continue;
      }
      $cell = [
        'kind' => 'person',
        'display_name' => $name,
        'initials' => $this->personInitials($name),
        'color' => $this->personColor((int) $account->id()),
      ];
      $mail = (string) ($account->getEmail() ?? '');
      if ($mail !== '' && $account->get('mail')->access('view')) {
        $cell['mail'] = $mail;
      }
      $elements[$delta] = $this->cellElement($cell);
    }
    return $elements;
  }

}
