<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Pins that freezing a ticket cancels its active runs in the same save.
 */
#[Group('bb_core')]
final class TicketFreezeCancelsRunTest extends ClaimKernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $freezer = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'freezer', 'status' => 1]);
    assert($freezer instanceof UserInterface);
    $freezer->save();
    $this->container->get('current_user')->setAccount($freezer);
  }

  /**
   * Freezing cancels every active run with a note naming the account.
   */
  public function testFreezeCancelsActiveRuns(): void {
    $ticket = $this->seedAssignedTicket('working');
    $running = $this->seedRun($ticket, 'working', 'running');
    $claimed = $this->seedRun($ticket, 'working', 'claimed');

    $this->reloadTicket($ticket)->setFrozen(TRUE)->save();

    foreach ([$running, $claimed] as $run) {
      $run = $this->reloadRun($run);
      self::assertSame('cancelled', $run->getRunState());
      self::assertStringEndsWith('frozen by freezer', (string) $run->getErrorLog());
    }
  }

  /**
   * Freezing without an active run changes no run and creates none.
   */
  public function testFreezeWithoutActiveRunChangesNothing(): void {
    $ticket = $this->seedAssignedTicket('working');
    $done = $this->seedRun($ticket, 'working', 'done');

    $this->reloadTicket($ticket)->setFrozen(TRUE)->save();

    $done = $this->reloadRun($done);
    self::assertSame('done', $done->getRunState());
    self::assertNull($done->getErrorLog());
    self::assertSame(1, $this->runCount());
  }

  /**
   * Only the freeze cancels: a re-save stays put, unfreeze lets a claim in.
   */
  public function testResaveAndUnfreezeCancelNothing(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->reloadTicket($ticket)->setFrozen(TRUE)->save();
    $run = $this->seedRun($ticket, 'working', 'running');

    $this->reloadTicket($ticket)->setTitle('renamed')->save();
    self::assertSame('running', $this->reloadRun($run)->getRunState(), 'A re-save of a frozen ticket cancels nothing.');

    $run->setRunState('done')->save();
    $this->reloadTicket($ticket)->setFrozen(FALSE)->save();
    $ticket = $this->reloadTicket($ticket);
    self::assertSame('working', $ticket->getState()->getId());
    self::assertSame(1, $this->runCount(), 'Unfreezing starts no run.');

    $claimed = $this->claimService->claimNext($this->conductor);
    self::assertNotNull($claimed);
    self::assertSame((int) $ticket->id(), $claimed->getTicketId());
    self::assertSame('working', $claimed->get('state_at_start')->value);
  }

  /**
   * A label written with the freeze stays; the run ends; no claim follows.
   */
  public function testLabelAndFreezeInOneSave(): void {
    $ticket = $this->seedAssignedTicket('working');
    $run = $this->seedRun($ticket, 'working', 'running');
    $label = $this->container->get('entity_type.manager')->getStorage('bb_term')
      ->create(['vid' => 'label', 'name' => 'Question']);
    $label->save();

    $this->reloadTicket($ticket)->set('labels', [$label->id()])->setFrozen(TRUE)->save();

    self::assertSame([(int) $label->id()], array_map('intval', array_column($this->reloadTicket($ticket)->get('labels')->getValue(), 'target_id')));
    $run = $this->reloadRun($run);
    self::assertSame('cancelled', $run->getRunState());
    self::assertStringEndsWith('frozen by freezer', (string) $run->getErrorLog());
    self::assertNull($this->claimService->claimNext($this->conductor), 'A frozen ticket is not claimed.');
  }

  /**
   * A save that freezes and reassigns cancels each run once, as frozen.
   */
  public function testFreezeAndReassignCancelOnce(): void {
    $ticket = $this->seedAssignedTicket('working');
    $run = $this->seedRun($ticket, 'working', 'running');

    $this->reloadTicket($ticket)->setFrozen(TRUE)->setConductor($this->otherConductor())->save();

    $run = $this->reloadRun($run);
    self::assertSame('cancelled', $run->getRunState());
    self::assertSame('frozen by freezer', $run->getErrorLog());
  }

  /**
   * The number of runs stored.
   */
  private function runCount(): int {
    return (int) $this->container->get('entity_type.manager')->getStorage('bb_run')
      ->getQuery()->accessCheck(FALSE)->count()->execute();
  }

  /**
   * A second conductor of the same owner on the same project.
   */
  private function otherConductor(): BbConductorInterface {
    $owner = $this->conductor->get('owner_user_id')->entity;
    assert($owner instanceof UserInterface);
    return $this->createConductor($owner, 'node-other', ['plan', 'working', 'review']);
  }

}
