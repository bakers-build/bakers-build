<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Review-bundle publication, immutability and authoring invariants.
 */
#[Constraint(
  id: 'BbReviewComment',
  label: new TranslatableMarkup('bakers.build review comment', [], ['context' => 'Validation']),
)]
final class BbReviewCommentConstraint extends SymfonyConstraint {
}
