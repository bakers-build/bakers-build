<?php

declare(strict_types=1);

namespace Drupal\island_test;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandViewAccessInterface;

/**
 * A host whose view access is CACHEABLE, and plentiful (BB-489).
 *
 * Three properties of the boosted GET path are about access rather than about
 * any one island, and until BB-489 all three were measured through placed
 * Drupal blocks: a decision that varies per visitor must put its cache contexts
 * on the response, a denied entry in `X-Island-Also` must be skipped while the
 * rest of the answer stands, and the also-list must be capped. Block placements
 * were only ever the cheap vehicle for them — a placement is one line, so
 * twenty of them are twenty lines — and the block mechanism is gone. This is
 * vehicle instead, which also moves the tests onto the placement mechanism the
 * product actually uses.
 *
 * `editors` is the role-gated one. Its denial is what an operator's visibility
 * condition is here: not "this island is off" but "this island is off FOR YOU",
 * so the decision carries `user.roles` and the response has to vary on it. A
 * missing cache tag serves stale content; a missing context serves another
 * user's content, and that is the failure this fixture makes reachable.
 *
 * `wing_0` … `wing_19` are twenty distinct, resolvable, VIEWABLE islands, so
 * that nothing but the cap itself can be what trims a twenty-entry also-list.
 * They are placements of one plugin rather than twenty plugins because the cap
 * counts ids, not classes.
 */
final class GatedHostProvider implements IslandContextProviderInterface, IslandViewAccessInterface {

  /**
   * How many `wing_*` placements this host declares.
   */
  public const WING_COUNT = 20;

  /**
   * The role `editors` requires.
   */
  private const REQUIRED_ROLE = 'editor';

  /**
   * {@inheritdoc}
   */
  public function hostId(): string {
    return 'gated';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(): array {
    $ids = ['open', 'editors'];
    for ($i = 0; $i < self::WING_COUNT; $i++) {
      $ids[] = 'wing_' . $i;
    }
    return $ids;
  }

  /**
   * Every placement is the same plugin; the placement id is what differs.
   */
  public function getIslandPluginId(string $island_id): string {
    return 'task_count';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandConfiguration(string $island_id): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandData(string $island_id): array {
    return ['count' => 3];
  }

  /**
   * {@inheritdoc}
   *
   * Both answers are cacheable and both name `user.roles`, the allowed one
   * included: a decision that would have gone the other way for a different
   * visitor varies on the visitor whichever way it went, and only saying so on
   * the denial is how a cache comes to serve the allowed answer to everyone.
   */
  public function accessIsland(string $island_id, AccountInterface $account): AccessResultInterface {
    return AccessResult::allowedIf(
      $island_id !== 'editors' || in_array(self::REQUIRED_ROLE, $account->getRoles(), TRUE),
    )
      ->addCacheContexts(['user.roles'])
      ->addCacheTags(['island_test:gated']);
  }

}
