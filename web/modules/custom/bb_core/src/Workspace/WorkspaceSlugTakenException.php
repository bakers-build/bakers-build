<?php

declare(strict_types=1);

namespace Drupal\bb_core\Workspace;

/**
 * Another workspace took the slug between validation and save.
 */
final class WorkspaceSlugTakenException extends \RuntimeException {

  /**
   * Constructs the exception.
   *
   * @param string $slug
   *   The slug that is taken.
   * @param \Throwable $previous
   *   The storage error the unique key raised.
   */
  public function __construct(public readonly string $slug, \Throwable $previous) {
    parent::__construct(sprintf('The workspace slug %s is already taken.', $slug), 0, $previous);
  }

}
