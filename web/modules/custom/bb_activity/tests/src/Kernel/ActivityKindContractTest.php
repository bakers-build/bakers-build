<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Component\Plugin\Exception\ContextException;
use Drupal\bb_activity\Activity\ActivityKindInterface;
use Drupal\bb_activity\Activity\ActivityKindManager;
use Drupal\bb_core\Entity\BbGroup;
use Drupal\bb_core\Entity\BbProject;
use Drupal\bb_core\Entity\BbTicketInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A kind records once from the contexts its causer sets on a fresh instance.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivityKindContractTest extends ActivityEntityKernelTestBase {

  /**
   * A missing required context fails the recording and writes nothing.
   */
  public function testRecordWithoutRequiredContextWritesNothing(): void {
    $this->ticket();
    $before = $this->rowCount();
    try {
      $this->kind('created')->record();
      self::fail('Expected a missing ticket context to fail the recording.');
    }
    catch (ContextException) {
    }
    self::assertSame($before, $this->rowCount());
  }

  /**
   * One instance records one row; a second call is a programming error.
   */
  public function testRecordIsOneShot(): void {
    $kind = $this->kind('created');
    $kind->setContextValue('entity', $this->ticket());
    $before = $this->rowCount();
    self::assertNotNull($kind->record());
    try {
      $kind->record();
      self::fail('Expected a second recording on one instance to fail.');
    }
    catch (\LogicException) {
    }
    self::assertSame($before + 1, $this->rowCount());
  }

  /**
   * Every instance is new; contexts set on one never reach another.
   */
  public function testInstancesAreFresh(): void {
    $a = $this->kind('created');
    $b = $this->kind('created');
    $a->setContextValue('entity', $this->ticket());
    self::assertNotSame($a, $b);
    self::assertFalse($b->getContext('entity')->hasContextValue());
    self::assertNotSame($this->manager()->all()[0], $this->manager()->all()[0]);
  }

  /**
   * A fresh instance of one kind.
   */
  private function kind(string $id): ActivityKindInterface {
    $kind = $this->manager()->createInstance($id);
    self::assertInstanceOf(ActivityKindInterface::class, $kind);
    return $kind;
  }

  /**
   * The kind manager.
   */
  private function manager(): ActivityKindManager {
    $manager = $this->container->get('plugin.manager.bb_activity_kind');
    self::assertInstanceOf(ActivityKindManager::class, $manager);
    return $manager;
  }

  /**
   * The number of stored activity rows.
   */
  private function rowCount(): int {
    return (int) $this->container->get('entity_type.manager')->getStorage('bb_activity')
      ->getQuery()->accessCheck(FALSE)->count()->execute();
  }

  /**
   * A saved work ticket.
   */
  private function ticket(): BbTicketInterface {
    $group = BbGroup::create(['name' => 'Contract group', 'workspace_id' => $this->hostWorkspace->id()]);
    $group->save();
    $project = BbProject::create(['name' => 'contract', 'key' => 'CON', 'group_id' => $group->id()]);
    $project->save();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'Contract',
      'project_id' => $project->id(),
      'workflow' => 'bb_work',
    ]);
    $ticket->save();
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

}
