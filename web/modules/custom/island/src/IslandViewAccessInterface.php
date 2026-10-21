<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;

/**
 * Host seam: who may see this host's islands on the boosted GET path.
 *
 * The boosted GET resolves an island from a client-sent html id, without
 * route scoping, so the host must declare who may see it. A host that does
 * not implement this interface is forbidden on that path, never open. Page
 * builds and mutations keep their own checks (route access,
 * IslandInterface::accessAction()). Access is per island id.
 */
interface IslandViewAccessInterface {

  /**
   * Whether this account may see one of this host's islands on its own.
   *
   * @param string $island_id
   *   The island plugin id, as it appears in getIslandIds().
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   The decision, carrying the cache contexts and tags it depends on. Those
   *   ride into the fragment response: a fragment rendered under a permission
   *   check must not be handed from a cache to somebody without it.
   *
   *   Only an ALLOWED result renders. `AccessResult::neutral()` — "I have no
   *   opinion" — refuses, like a forbidden one: there is nobody else in this
   *   chain to hold the opinion, so an abstention can only safely mean no.
   */
  public function accessIsland(string $island_id, AccountInterface $account): AccessResultInterface;

}
