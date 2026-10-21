<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\user\UserInterface;

/**
 * The per-person derivations `person` refuses to make itself.
 *
 * Shared so one person gets the same name, mark and colour in every table;
 * the colour matches CommentAuthorColorItemList (uid modulo the five keys).
 */
trait PersonIdentityTrait {

  /**
   * The `person` colour keys, in the order the enum declares them.
   */
  private const array PERSON_COLORS = ['running', 'attention', 'unassigned', 'lease', 'offline'];

  /**
   * The colour one account is drawn with, everywhere.
   *
   * @param int $uid
   *   The account id.
   *
   * @return string
   *   One of the `person` colour keys.
   */
  protected function personColor(int $uid): string {
    return self::PERSON_COLORS[$uid % count(self::PERSON_COLORS)];
  }

  /**
   * The first letter of each of the first two words of a name.
   *
   * @param string $name
   *   The display name.
   *
   * @return string
   *   Up to two upper-case letters.
   */
  protected function personInitials(string $name): string {
    $parts = preg_split('/\s+/', trim($name)) ?: [];
    $letters = array_map(
      static fn (string $part): string => mb_strtoupper(mb_substr($part, 0, 1)),
      $parts,
    );
    return implode('', array_slice($letters, 0, 2));
  }

  /**
   * The full name if the account entered one, else its account name.
   *
   * Scoped to bakers.build's person props on purpose: a global
   * hook_user_format_name_alter() would rename the account everywhere.
   */
  protected function personDisplayName(UserInterface $account): string {
    if ($account->hasField('field_full_name')) {
      $full_name = (string) $account->get('field_full_name')->value;
      if ($full_name !== '') {
        return $full_name;
      }
    }
    return (string) $account->label();
  }

}
