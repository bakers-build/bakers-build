<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\bb_activity\Activity\ActivityKindManager;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * What the module does to an activity table it adopts on install.
 *
 * A site from before the module already has bb_activity; the module
 * installer keeps its tables and this module's hook_install() only drops the
 * column no longer defined.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivityInstallTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'bb_core', 'bb_activity',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_ticket',
      'bb_activity', 'bb_notification_setting',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    require_once $this->root . '/' . $this->container->get('extension.list.module')->getPath('bb_activity') . '/bb_activity.install';
  }

  /**
   * An old claim key column and its unique key go; the rows stay.
   */
  public function testInstallDropsTheOldClaimKeyAndKeepsTheRows(): void {
    $schema = $this->container->get('database')->schema();
    $schema->addField('bb_activity', 'claim_key', ['type' => 'varchar', 'length' => 128, 'not null' => FALSE]);
    $schema->addUniqueKey('bb_activity', 'bb_activity__claim_key', ['claim_key']);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_activity');
    $row = $storage->create(['kind' => 'claimed', 'ticket_id' => 1]);
    $row->save();

    _bb_activity_drop_claim_key();
    _bb_activity_drop_claim_key();

    self::assertFalse($schema->fieldExists('bb_activity', 'claim_key'));
    self::assertNotNull($storage->loadUnchanged($row->id()));
    self::assertArrayNotHasKey('bb_activity', \Drupal::entityDefinitionUpdateManager()->getChangeSummary());
  }

  /**
   * Builder working copies of the activity displays go; others stay.
   *
   * They hold sample entities serialized under the class from before the
   * move, which the config import of the display cannot save again.
   */
  public function testInstallDropsTheBuilderCopiesOfTheActivityDisplays(): void {
    $state = $this->container->get('state');
    $stale = 'entity_view__bb_activity__bb_activity__full';
    $kept = 'entity_view__bb_ticket__bb_ticket__full';
    $state->set('display_builder_index', [$stale => '', $kept => '']);
    $state->set('display_builder_' . $stale, ['contexts' => 'O:36:"Drupal\bb_core\Entity\BbActivity":0:{}']);
    $state->set('display_builder_' . $kept, ['id' => $kept]);

    _bb_activity_drop_builder_copies();
    _bb_activity_drop_builder_copies();

    $state->resetCache();
    self::assertSame([$kept => ''], $state->get('display_builder_index'));
    self::assertNull($state->get('display_builder_' . $stale));
    self::assertSame(['id' => $kept], $state->get('display_builder_' . $kept));
  }

  /**
   * The kind column takes its allowed values from the kind plugins.
   */
  public function testKindValuesComeFromThePlugins(): void {
    $kind = \Drupal::entityDefinitionUpdateManager()->getFieldStorageDefinition('kind', 'bb_activity');
    self::assertNotNull($kind);
    self::assertSame(ActivityKindManager::class . '::allowedValues', $kind->getSetting('allowed_values_function'));
    self::assertSame('Claimed', options_allowed_values($kind)['claimed'] ?? NULL);
  }

}
