<?php

declare(strict_types=1);

namespace Drupal\island_test;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandViewAccessInterface;

/**
 * Kernel/e2e test host: five islands with static task data.
 *
 * `renamed` overrides its own html id. It is registered here rather than left
 * unhosted because the html-id resolver verifies its answer by asking the
 * island it parsed out, and an island the host does not claim would never
 * reach that step.
 *
 * `rail` is the only one that declares a client-side update contract. It is
 * kept apart from `task_list` and `task_count` on purpose: those two are the
 * mutation path's fixtures, and giving them a declaration would change the
 * markup IslandResponderTest reads without any mutation behaviour changing.
 *
 * `task_form` is the only one whose build carries a FORM, for the same reason —
 * it is what lets IslandMutationPathTest see whether the responder resolved the
 * CSRF placeholder, and it is kept out of the other fixtures' markup.
 */
final class TestHostProvider implements IslandContextProviderInterface, IslandViewAccessInterface {

  /**
   * {@inheritdoc}
   */
  public function hostId(): string {
    return 'tasks';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(): array {
    return ['task_list', 'task_count', 'quiet', 'renamed', 'rail', 'task_form'];
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
   * `quiet` is denied so the per-island granularity is exercised rather than
   * asserted: a host that answered per host could not produce this fixture.
   */
  public function accessIsland(string $island_id, AccountInterface $account): AccessResultInterface {
    return $island_id === 'quiet'
      ? AccessResult::forbidden('This island is not viewable on its own.')
      : AccessResult::allowed();
  }

}
