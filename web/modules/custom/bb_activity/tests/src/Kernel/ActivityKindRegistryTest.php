<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\bb_activity\Activity\ActivityKindInterface;
use Drupal\bb_activity\Activity\ActivityKindManager;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The activity kinds are plugins; the stored kind values follow them.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivityKindRegistryTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text',
    'bb_core', 'bb_activity',
  ];

  /**
   * The shipped ticket and run kinds, in the order they are asked and listed.
   */
  private const KINDS = ['created', 'status_changed', 'claimed', 'run_ended'];

  /**
   * The shipped assignment and review kinds, asked and listed after them.
   */
  private const ADDRESSED_KINDS = ['assigned', 'review_requested', 'review_completed'];

  /**
   * Every kind is a plugin whose ID is the stored value.
   */
  public function testTheKindsAreThePluginsInWeightOrder(): void {
    $ids = array_map(
      static fn (ActivityKindInterface $kind): string => $kind->getPluginId(),
      $this->manager()->all(),
    );
    self::assertSame([...self::KINDS, ...self::ADDRESSED_KINDS], $ids);
  }

  /**
   * The kind field allows exactly the plugin IDs, with their labels.
   */
  public function testTheKindFieldAllowsExactlyThePluginIds(): void {
    $definition = $this->container->get('entity_field.manager')->getFieldStorageDefinitions('bb_activity')['kind'];
    self::assertSame(
      [
        'created' => 'Created',
        'status_changed' => 'Status changed',
        'claimed' => 'Claimed',
        'run_ended' => 'Run ended',
        'assigned' => 'Assigned',
        'review_requested' => 'Review requested',
        'review_completed' => 'Review completed',
      ],
      options_allowed_values($definition),
    );
  }

  /**
   * The kind plugin manager.
   */
  private function manager(): ActivityKindManager {
    $manager = $this->container->get('plugin.manager.bb_activity_kind');
    self::assertInstanceOf(ActivityKindManager::class, $manager);
    return $manager;
  }

}
