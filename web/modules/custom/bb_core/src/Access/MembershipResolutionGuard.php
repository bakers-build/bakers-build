<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

/**
 * Marks bakers.build's own membership resolution, so the read scope cannot filter it.
 *
 * The `og_membership` query-access rule is resolved from `og_membership`, so
 * the read scope and rank resolution would recurse without bound. While this
 * guard is set the listener leaves the query unnarrowed (not falsified, which
 * would make every account look rankless). A depth counter, because the two
 * resolvers nest.
 *.
 *
 * @see \Drupal\bb_core\EventSubscriber\WorkspaceReadScopeSubscriber
 * @see \Drupal\bb_core\Access\BbWorkspaceReadScope
 * @see \Drupal\bb_core\Access\BbRankCapability
 */
final class MembershipResolutionGuard {

  /**
   * How many membership resolutions are currently on the stack.
   */
  private int $depth = 0;

  /**
   * Whether bakers.build is resolving memberships right now.
   *
   * @return bool
   *   TRUE while a resolution is on the stack.
   */
  public function isResolving(): bool {
    return $this->depth > 0;
  }

  /**
   * Runs a membership resolution with the guard raised.
   *
   * @param callable $resolve
   *   The resolution to run.
   *
   * @return mixed
   *   Whatever the resolution returned.
   *
   * @phpstan-template T
   * @phpstan-param callable(): T $resolve
   * @phpstan-return T
   */
  public function resolving(callable $resolve): mixed {
    $this->depth++;
    try {
      return $resolve();
    }
    finally {
      // In a `finally`, so an exception inside the resolution cannot leave the
      // guard raised for the rest of the request — which would silently unbound
      // every later membership read.
      $this->depth--;
    }
  }

}
