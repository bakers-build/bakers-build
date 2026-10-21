<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates that an environment name is unique within its project.
 *
 * Applied to the name field of BbEnvironment. Two environments in the same
 * project may not share a name; the same name in different projects is allowed.
 */
#[Constraint(
  id: 'BbEnvironmentUniquePerProject',
  label: new TranslatableMarkup('bakers.build environment unique per project'),
)]
final class BbEnvironmentUniquePerProjectConstraint extends SymfonyConstraint {

  /**
   * Violation message when the name is already used in the same project.
   *
   * @var string
   */
  public string $message = 'An environment named %name already exists in this project.';

}
