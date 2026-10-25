<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the computed `sub_tickets` field is ordered by priority.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class SubTicketsPriorityOrderTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_group', 'bb_project', 'bb_ticket'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
  }

  /**
   * The computed sub_tickets list is ordered by priority, not creation order.
   */
  public function testSubTicketsOrderedByPriority(): void {
    $etm = $this->container->get('entity_type.manager');
    assert($etm instanceof EntityTypeManagerInterface);
    $project = $etm->getStorage('bb_project')->create(['name' => 'p']);
    $project->save();
    $storage = $etm->getStorage('bb_ticket');

    $parent = $storage->create([
      'workflow' => 'bb_work',
      'title' => 'Parent',
      'state' => 'todo',
      'project_id' => $project->id(),
    ]);
    assert($parent instanceof ContentEntityInterface);
    $parent->save();

    // Created out of priority order to prove sorting is by priority.
    $mid = $storage->create([
      'workflow' => 'bb_work',
      'title' => 'B',
      'state' => 'todo',
      'project_id' => $project->id(),
      'parent_id' => $parent->id(),
      'priority' => 2,
    ]);
    $mid->save();
    $first = $storage->create([
      'workflow' => 'bb_work',
      'title' => 'A',
      'state' => 'todo',
      'project_id' => $project->id(),
      'parent_id' => $parent->id(),
      'priority' => 1,
    ]);
    $first->save();

    $ids = array_map(
      static fn ($item) => $item['target_id'],
      $parent->get('sub_tickets')->getValue(),
    );
    self::assertSame([$first->id(), $mid->id()], $ids);
  }

}
