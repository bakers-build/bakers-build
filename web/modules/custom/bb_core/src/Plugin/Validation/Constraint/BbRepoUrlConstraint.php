<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates that a repository URL is an https, ssh:// or SSH shorthand URL.
 *
 * Applied to the `url` property of the bb_repo field type. Accepts the clone
 * URL forms git tooling understands — https(s), ssh:// and the scp shorthand
 * (git@host:path.git) — and rejects genuinely malformed strings with a
 * specific message naming the offending value.
 */
#[Constraint(
  id: 'BbRepoUrl',
  label: new TranslatableMarkup('bakers.build repository URL'),
)]
final class BbRepoUrlConstraint extends SymfonyConstraint {

  /**
   * Violation message for a malformed repository URL.
   *
   * @var string
   */
  public string $message = 'The repository URL %url is not valid. Use an https:// URL, an ssh://[user@]host[:port]/path URL, or the SSH shorthand user@host:path.';

}
