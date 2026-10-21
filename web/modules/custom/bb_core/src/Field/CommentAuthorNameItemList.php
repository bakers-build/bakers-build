<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\user\UserInterface;

/**
 * Computes the display name of a comment's author.
 *
 * Presentation-only derivation for the comment_event component (used in the
 * bb_comment full view). Reads the author user reference; the user entity
 * stays the source of truth.
 */
final class CommentAuthorNameItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $author = $this->getEntity()->get('author')->entity;
    $name = $author instanceof UserInterface ? (string) $author->getDisplayName() : '';
    $this->list[0] = $this->createItem(0, $name);
  }

}
