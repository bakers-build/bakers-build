<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Validates a bb_workspace slug — pattern, uniqueness, reserved words.
 *
 * The slug is the first path segment of every bakers.build product URL,
 * which is why one constraint carries all three rules: they are three ways for
 * the same value to be unusable as a root segment, and splitting them would
 * split the reason.
 */
#[Constraint(
  id: 'BbWorkspaceSlug',
  label: new TranslatableMarkup('bakers.build workspace slug'),
)]
final class BbWorkspaceSlugConstraint extends SymfonyConstraint {

  /**
   * The shape a slug must have to be safe as a root path segment.
   *
   * Lowercase alphanumerics with inner hyphens, 1–64 characters, never
   * starting or ending with a hyphen. Lowercase because the path emits
   * lowercase and the lookup is an exact match; no dots, slashes or
   * percent signs because those change how a path is parsed.
   *
   * @var string
   */
  public const PATTERN = '/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/';

  /**
   * Root path segments a workspace may not claim.
   *
   * Hand-maintained, and therefore guarded by ReservedSlugCoverageTest, which
   * fails when a static root segment of the live router is missing here. Also
   * reserves names Drupal owns generically (`node`, `media`, …) so a later
   * install cannot strand a workspace, and `home`: a workspace slugged `home`
   * would rewrite the front page into `/_workspace/home` and 404 it silently.
   * Pattern-invalid entries (`.well-known`) cost nothing and document it.
   *
   * @var array<string>
   */
  public const RESERVED = [
    '.well-known',
    'admin',
    'ajax',
    'api',
    'batch',
    'block-category',
    'comment',
    'core',
    'cron',
    'entity',
    'file',
    'filter',
    'group',
    'home',
    'install',
    'jsonapi',
    'libraries',
    'login',
    'logout',
    'media',
    'modules',
    'node',
    'oauth',
    'oauth2',
    'profiles',
    'search',
    'session',
    'sites',
    'system',
    'taxonomy',
    'themes',
    'toolbar',
    'ui-icons',
    'update',
    'user',
    'views',
    'views-autocomplete-filters',
  ];

  /**
   * Violation message when the slug does not match PATTERN.
   *
   * @var string
   */
  public string $patternMessage = 'The slug %slug is not valid. Use 1 to 64 lowercase letters, digits and inner hyphens, starting and ending with a letter or digit.';

  /**
   * Violation message when another workspace already uses the slug.
   *
   * @var string
   */
  public string $uniqueMessage = 'The slug %slug is already used by another workspace.';

  /**
   * Violation message when the slug is a reserved root path segment.
   *
   * @var string
   */
  public string $reservedMessage = 'The slug %slug is reserved: it is a path segment this site already uses.';

}
