<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\Entity\Plugin\Validation\Constraint\CompositeConstraintBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;

/**
 * Validates that a ticket template's target state fits its workflow.
 *
 * Composite over `workflow` and `target_state`, so a JSON:API PATCH naming
 * only one of them still reports the conflict.
 */
#[Constraint(
  id: 'BbTemplateTargetState',
  label: new TranslatableMarkup('bakers.build ticket template target state'),
  type: ['entity'],
)]
final class BbTemplateTargetStateConstraint extends CompositeConstraintBase {

  /**
   * Violation message for a state the workflow cannot reach.
   *
   * @var string
   */
  public string $message = 'The target state %state cannot be reached from the start of the selected workflow.';

  /**
   * {@inheritdoc}
   */
  public function coversFields(): array {
    return ['workflow', 'target_state'];
  }

}
