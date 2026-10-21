<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\user\UserInterface;

/**
 * Computes the initials of a comment's author.
 *
 * Presentation-only derivation for the comment_event component: up to two
 * upper-case letters from the author's display name (word initials, or the
 * first two characters as a fallback).
 */
final class CommentAuthorInitialsItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $author = $this->getEntity()->get('author')->entity;
    $name = $author instanceof UserInterface ? trim((string) $author->getDisplayName()) : '';
    $initials = '';
    if ($name !== '') {
      $words = preg_split('/\s+/', $name) ?: [];
      $initials = count($words) >= 2
        ? mb_strtoupper(mb_substr($words[0], 0, 1) . mb_substr(end($words), 0, 1))
        : mb_strtoupper(mb_substr($name, 0, 2));
    }
    $this->list[0] = $this->createItem(0, $initials);
  }

}
