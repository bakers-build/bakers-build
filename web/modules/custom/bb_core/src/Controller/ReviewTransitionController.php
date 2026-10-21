<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Form\ReviewStateTransitionForm;

/**
 * Processes a review's state widget outside the ticket canvas.
 */
final class ReviewTransitionController extends ControllerBase {

  /**
   * The state widget of one review as the page's main content.
   *
   * @return array<string, mixed>
   *   The form render array.
   */
  public function form(BbCommentInterface $bb_comment): array {
    return $this->formBuilder()->getForm(ReviewStateTransitionForm::forReview($bb_comment));
  }

}
