<?php

declare(strict_types=1);

namespace Drupal\island_test;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandViewAccessInterface;

/**
 * A host that claims an island id with no plugin behind it.
 *
 * It grants view access deliberately, so that a test naming its island measures
 * what happens when the plugin cannot be created rather than stopping at the
 * access gate. The resolver has to answer that with a miss: every other
 * unservable id on this path gets one, and an uncaught PluginNotFoundException
 * would turn an ordinary boosted click into a 500 on a page that loads fine
 * directly.
 */
final class BrokenHostProvider implements IslandContextProviderInterface, IslandViewAccessInterface {

  /**
   * {@inheritdoc}
   */
  public function hostId(): string {
    return 'broken';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(): array {
    return ['not_a_plugin'];
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
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function accessIsland(string $island_id, AccountInterface $account): AccessResultInterface {
    return AccessResult::allowed();
  }

}
