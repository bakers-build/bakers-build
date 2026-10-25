<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies the referenced_tickets base field on bb_ticket (BB-140).
 *
 * A bb_deployment ticket stores its release batch here. The getter returns
 * the referenced BbTicket entities; an empty field yields an empty array.
 */
#[Group('bb_core')]
final class ReferencedTicketsFieldTest extends KernelTestBase {

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
   * The referenced_tickets getter returns the referenced ticket entities.
   */
  public function testReferencedTicketsRoundTrip(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')->create(['name' => 'p']);
    $project->save();

    $a = $storage->create([
      'workflow' => 'bb_work',
      'title' => 'A',
      'state' => 'done',
      'project_id' => $project->id(),
    ]);
    $a->save();
    $b = $storage->create([
      'workflow' => 'bb_work',
      'title' => 'B',
      'state' => 'done',
      'project_id' => $project->id(),
    ]);
    $b->save();

    $deployment = $storage->create([
      'workflow' => 'bb_deployment',
      'title' => 'Release',
      'state' => 'pre_deployment',
      'project_id' => $project->id(),
      'referenced_tickets' => [$a->id(), $b->id()],
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $deployment);
    $deployment->save();

    $storage->resetCache([$deployment->id()]);
    $reloaded = $storage->load($deployment->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);

    $ids = array_map(static fn ($t): int => (int) $t->id(), $reloaded->getReferencedTickets());
    $this->assertSame([(int) $a->id(), (int) $b->id()], $ids);
  }

  /**
   * A deployment with no referenced tickets yields an empty array.
   */
  public function testReferencedTicketsEmptyByDefault(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')->create(['name' => 'p']);
    $project->save();
    $deployment = $storage->create([
      'workflow' => 'bb_deployment',
      'title' => 'Release',
      'state' => 'pre_deployment',
      'project_id' => $project->id(),
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $deployment);
    $deployment->save();

    $this->assertSame([], $deployment->getReferencedTickets());
  }

}
