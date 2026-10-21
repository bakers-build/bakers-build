<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates the role and team an invitation grants.
 *
 * Applied to the whole `bb_invite`, because both checks need its workspace.
 * The Members form and a JSON:API write run the same rule.
 */
#[Constraint(
  id: 'BbInviteAssignment',
  label: new TranslatableMarkup('bakers.build invitation assignment'),
  type: ['entity:bb_invite'],
)]
final class BbInviteAssignmentConstraint extends SymfonyConstraint {

  /**
   * Violation message for an account that may not change the workspace crew.
   *
   * @var string
   */
  public string $accessMessage = 'You may not assign roles in %workspace.';

  /**
   * Violation message for a role this workspace does not offer.
   *
   * @var string
   */
  public string $roleMessage = 'Choose a workspace role this workspace offers.';

  /**
   * Violation message for a team outside the invitation's workspace.
   *
   * @var string
   */
  public string $teamMessage = 'Choose a team of %workspace.';

}
