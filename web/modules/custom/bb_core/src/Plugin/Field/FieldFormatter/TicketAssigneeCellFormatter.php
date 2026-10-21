<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * The assignee column: an identity, or the named absence of one.
 *
 * An unclaimed ticket is a state someone acts on, so it renders
 * `Unassigned` beside a neutral placeholder mark instead of the template's
 * em-dash; this is why the formatter renders for an empty item list. Access
 * is `view label`, as in `entity_reference_label`, because no bakers.build role
 * holds `access user profiles`. Mark and colour come from PersonIdentityTrait
 * so one person looks the same in every table.
 */
#[FieldFormatter(
  id: 'bb_ticket_assignee_cell',
  label: new TranslatableMarkup('Table cell: person'),
  description: new TranslatableMarkup('The referenced account as a person cell, naming the absence when there is none.'),
  field_types: ['entity_reference'],
)]
class TicketAssigneeCellFormatter extends TicketReferenceCellFormatterBase {

  use PersonIdentityTrait;

  /**
   * Whether the name is only a tooltip beside the mark.
   */
  protected const NAME_HIDDEN = FALSE;

  /**
   * Whether an empty reference renders the "Unassigned" placeholder.
   */
  protected const PLACEHOLDER = TRUE;

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    // The anonymous account (uid 0) is nobody, not a person called Anonymous.
    $entities = array_filter(
      $this->getEntitiesToView($items, $langcode),
      static fn ($entity): bool => !($entity instanceof AccountInterface && $entity->isAnonymous()),
    );
    if ($entities === [] && static::PLACEHOLDER) {
      // A neutral placeholder mark keeps the column aligned with the people
      // around it; the name still says that nobody holds the item.
      return [
        $this->cellElement($this->person([
          'display_name' => (string) new TranslatableMarkup('Unassigned'),
          'initials' => '?',
          'color' => 'offline',
        ])),
      ];
    }

    $elements = [];
    foreach ($entities as $delta => $entity) {
      $name = (string) $entity->label();
      $elements[$delta] = $this->cellElement($this->person([
        'display_name' => $name,
        'initials' => $this->personInitials($name),
        'color' => $this->personColor((int) $entity->id()),
      ]));
    }
    return $elements;
  }

  /**
   * A person cell from its identity.
   *
   * @param array<string, string> $identity
   *   Display name, initials and colour.
   *
   * @return array<string, mixed>
   *   The cell.
   */
  private function person(array $identity): array {
    $cell = ['kind' => 'person'] + $identity;
    if (static::NAME_HIDDEN) {
      $cell['name_hidden'] = TRUE;
    }
    return $cell;
  }

}
