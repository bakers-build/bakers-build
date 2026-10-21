<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;

/**
 * Computes the avatar colour key of a comment's author.
 *
 * Presentation-only derivation for the comment_event component: a stable key
 * from the comment_event `author_color` enum, chosen deterministically per
 * author id so distinct authors get distinct avatar colours.
 */
final class CommentAuthorColorItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * The comment_event `author_color` enum values.
   */
  private const array COLORS = ['running', 'attention', 'unassigned', 'lease', 'offline'];

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $author = $this->getEntity()->get('author')->entity;
    $uid = $author ? (int) $author->id() : 0;
    $color = self::COLORS[$uid % count(self::COLORS)];
    $this->list[0] = $this->createItem(0, $color);
  }

}
