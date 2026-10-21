<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;

/**
 * Applies a review_state transition after asserting the state item type.
 */
trait ReviewStateTrait {

  /**
   * Applies a review workflow transition on a saved review comment.
   */
  protected function applyReviewTransition(BbCommentInterface $comment, string $id): void {
    $item = $comment->get('review_state')->first();
    self::assertInstanceOf(StateItemInterface::class, $item);
    $item->applyTransitionById($id);
  }

}
