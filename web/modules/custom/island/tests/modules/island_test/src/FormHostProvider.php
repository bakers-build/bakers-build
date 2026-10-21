<?php

declare(strict_types=1);

namespace Drupal\island_test;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\island\IslandContextProviderInterface;
use Drupal\island\IslandViewAccessInterface;
use Drupal\island_test\Form\TestMultiTriggerForm;

/**
 * Kernel test host for the mutation path: one form island, one sealed island.
 *
 * Kept apart from TestHostProvider on purpose. That host is the boosted-GET
 * path's fixture and several tests read its rendered ids as a SET, so adding a
 * form island to it would change markup those tests assert on without any
 * behaviour of theirs changing.
 *
 * It REMEMBERS what its form recorded, for the length of one request. A
 * container service is per request in Drupal, so an in-memory property is
 * enough to make "the submit handler actually ran" observable in the very
 * response the submit produced — which is the whole point: a test that only
 * asserted validation ran would pass against a form that never submits.
 *
 * `configured_task` is placed under `configured_form` (BB-443) via
 * `getIslandPluginId()` rather than under its own bespoke plugin class — the
 * property this fixture proves is that the placement id, not the underlying
 * plugin's own id, is what the resulting html id follows.
 */
final class FormHostProvider implements IslandContextProviderInterface, IslandViewAccessInterface {

  /**
   * What the island's form last recorded during this request.
   */
  private string $recorded = '';

  /**
   * {@inheritdoc}
   */
  public function hostId(): string {
    return 'forms';
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(): array {
    return ['task_add', 'quiet', 'configured_task'];
  }

  /**
   * Routes `configured_task` onto the generic form-backed island plugin.
   */
  public function getIslandPluginId(string $island_id): string {
    return $island_id === 'configured_task' ? 'configured_form' : $island_id;
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandConfiguration(string $island_id): array {
    if ($island_id === 'configured_task') {
      return [
        'form_class' => TestMultiTriggerForm::class,
        'required_data_key' => 'enabled',
      ];
    }
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandData(string $island_id): array {
    return ['recorded' => $this->recorded, 'enabled' => TRUE];
  }

  /**
   * {@inheritdoc}
   *
   * `quiet` is denied so the POST path's access gate is exercised against a
   * host that DOES declare view access — a host that declares none is already
   * forbidden by omission and would pass the test for the wrong reason.
   */
  public function accessIsland(string $island_id, AccountInterface $account): AccessResultInterface {
    return $island_id === 'quiet'
      ? AccessResult::forbidden('This island is not viewable on its own.')
      : AccessResult::allowed();
  }

  /**
   * Records what the island's form submitted.
   */
  public function record(string $title): void {
    $this->recorded = $title;
  }

}
