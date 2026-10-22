<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies per-project running ticket identifiers `KEY-<n>`.
 *
 * On first save a ticket draws the project's `next_number` under a row lock,
 * freezes it into `number`, and builds `identifier = <project key>-<number>`.
 * The number is monotonic per project, never reused, and never recomputed.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketIdentifierTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership',
      'bb_group',
      'bb_project',
      'bb_conductor',
      'bb_ticket',
      'bb_comment',
      'bb_run',
      'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
  }

  /**
   * Creates and saves a project with the given key.
   */
  private function createProject(string $name, string $key): BbProjectInterface {
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => $name, 'key' => $key]);
    $this->assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Reads a project's authoritative next_number straight from the DB.
   *
   * The counter is mutated by raw SQL under a row lock, so a loaded project
   * entity may hold a stale cached value; the DB column is the source of truth.
   */
  private function readNextNumber(BbProjectInterface $project): int {
    return (int) $this->container->get('database')
      ->select('bb_project', 'p')
      ->fields('p', ['next_number'])
      ->condition('id', $project->id())
      ->execute()
      ->fetchField();
  }

  /**
   * Forces a project's next_number in the DB, simulating counter drift.
   *
   * Mirrors the real bug: the standalone counter falls behind max(number)
   * (a reseed, an explicit-number create, or a lost bump) so the next
   * allocation would otherwise reuse an already-used number.
   */
  private function driftNextNumber(BbProjectInterface $project, int $value): void {
    $this->container->get('database')->update('bb_project')
      ->fields(['next_number' => $value])
      ->condition('id', $project->id())
      ->execute();
    $this->container->get('entity_type.manager')
      ->getStorage('bb_project')->resetCache([$project->id()]);
  }

  /**
   * Creates and saves a ticket in the given project.
   */
  private function createTicket(BbProjectInterface $project, string $title): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'project_id' => $project->id(),
        'workflow' => 'bb_bug',
        'title' => $title,
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * The ticket has a `number` field.
   */
  public function testNumberFieldExists(): void {
    $project = $this->createProject('Bb', 'BB');
    $ticket = $this->createTicket($project, 'First');
    $this->assertTrue($ticket->hasField('number'));
  }

  /**
   * Tickets in one project get sequential identifiers 1, 2, 3.
   */
  public function testSequentialPerProject(): void {
    $project = $this->createProject('Bb', 'BB');
    $a = $this->createTicket($project, 'A');
    $b = $this->createTicket($project, 'B');
    $c = $this->createTicket($project, 'C');
    $this->assertSame('BB-1', $a->getIdentifier());
    $this->assertSame('BB-2', $b->getIdentifier());
    $this->assertSame('BB-3', $c->getIdentifier());
    $this->assertSame(1, (int) $a->get('number')->value);
    $this->assertSame(3, (int) $c->get('number')->value);
  }

  /**
   * Two projects keep independent counters (BB-1 and WEB-1 coexist).
   */
  public function testTwoProjectsIndependent(): void {
    $bakers = $this->createProject('Bb', 'BB');
    $web = $this->createProject('Web Shop', 'WEB');
    $g1 = $this->createTicket($bakers, 'G1');
    $w1 = $this->createTicket($web, 'W1');
    $g2 = $this->createTicket($bakers, 'G2');
    $this->assertSame('BB-1', $g1->getIdentifier());
    $this->assertSame('WEB-1', $w1->getIdentifier());
    $this->assertSame('BB-2', $g2->getIdentifier());
  }

  /**
   * Deleting the highest ticket does not lower the next number (no reuse).
   */
  public function testMonotonicAfterDelete(): void {
    $project = $this->createProject('Bb', 'BB');
    $this->createTicket($project, 'A');
    $this->createTicket($project, 'B');
    $c = $this->createTicket($project, 'C');
    $c->delete();
    $d = $this->createTicket($project, 'D');
    $this->assertSame('BB-4', $d->getIdentifier());
  }

  /**
   * Re-saving a ticket never reallocates its number or identifier.
   */
  public function testResaveKeepsNumber(): void {
    $project = $this->createProject('Bb', 'BB');
    $ticket = $this->createTicket($project, 'A');
    $this->assertSame('BB-1', $ticket->getIdentifier());
    $ticket->setTitle('A renamed');
    $ticket->save();
    $this->assertSame('BB-1', $ticket->getIdentifier());
    $this->assertSame(1, (int) $ticket->get('number')->value);
    // next_number advanced only once, despite two saves.
    $this->assertSame(2, $this->readNextNumber($project));
  }

  /**
   * A frozen identifier survives a later rename of the project key.
   */
  public function testIdentifierFrozenOnKeyRename(): void {
    $project = $this->createProject('Bb', 'BB');
    $ticket = $this->createTicket($project, 'A');
    $this->assertSame('BB-1', $ticket->getIdentifier());
    $project->set('key', 'CORE');
    $project->save();
    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    $this->assertSame('BB-1', $reloaded->getIdentifier());
    $this->assertSame(1, (int) $reloaded->get('number')->value);
  }

  /**
   * A drifted counter cannot reuse an already-allocated number (AC-1).
   *
   * The allocator floors on max(number)+1 under the lock, so even when
   * next_number has fallen back onto an existing number the create advances
   * past it instead of minting a duplicate identifier.
   */
  public function testDriftedCounterCannotReuseNumber(): void {
    $project = $this->createProject('Bb', 'BB');
    $first = $this->createTicket($project, 'A');
    $this->assertSame('BB-1', $first->getIdentifier());
    // Counter drifts back onto the number just used.
    $this->driftNextNumber($project, 1);
    $second = $this->createTicket($project, 'B');
    $this->assertSame(2, (int) $second->get('number')->value);
    $this->assertSame('BB-2', $second->getIdentifier());
    $this->assertNotSame($first->getIdentifier(), $second->getIdentifier());
    $this->assertSame(3, $this->readNextNumber($project));
  }

  /**
   * Allocation floors on max(number)+1 when the counter is well behind (AC-1).
   */
  public function testAllocationFloorsOnMaxNumber(): void {
    $project = $this->createProject('Bb', 'BB');
    $this->createTicket($project, 'A');
    $this->createTicket($project, 'B');
    $this->createTicket($project, 'C');
    // next_number is 4; drift it back to 2.
    $this->driftNextNumber($project, 2);
    $next = $this->createTicket($project, 'D');
    $this->assertSame(4, (int) $next->get('number')->value);
    $this->assertSame('BB-4', $next->getIdentifier());
    $this->assertSame(5, $this->readNextNumber($project));
  }

  /**
   * A create still advances after an in-between update (AC-5).
   *
   * The empty-number guard keeps the update idempotent, and the following
   * create draws the next distinct number.
   */
  public function testCreateAdvancesAfterUpdate(): void {
    $project = $this->createProject('Bb', 'BB');
    $a = $this->createTicket($project, 'A');
    $a->setTitle('A renamed');
    $a->save();
    $b = $this->createTicket($project, 'B');
    $this->assertSame(1, (int) $a->get('number')->value);
    $this->assertSame(2, (int) $b->get('number')->value);
    $this->assertSame(3, $this->readNextNumber($project));
  }

  /**
   * Sequential allocations yield distinct, gapless numbers (row-lock contract).
   *
   * A kernel test cannot fork real concurrent transactions; this asserts the
   * allocation invariant the FOR UPDATE lock guarantees: each save consumes
   * exactly one number and advances next_number by exactly one.
   */
  public function testConcurrentAllocationNoCollision(): void {
    $project = $this->createProject('Bb', 'BB');
    $a = $this->createTicket($project, 'A');
    $b = $this->createTicket($project, 'B');
    $this->assertNotSame($a->getIdentifier(), $b->getIdentifier());
    $this->assertSame(3, $this->readNextNumber($project));
  }

}
