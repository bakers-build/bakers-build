<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Claim\ClaimConflictException;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers the freeze dimension of the claim gate (BB-302, AC-2 / AC-3).
 */
#[Group('bb_core')]
final class ClaimFrozenTest extends ClaimKernelTestBase {

  /**
   * A frozen classified ticket is refused, and no run is created (AC-2).
   */
  public function testFrozenClassifiedTicketIsRefused(): void {
    $ticket = $this->seedAssignedTicket('coding');
    $ticket->setFrozen(TRUE)->save();

    try {
      $this->claimService->claim($ticket, $this->conductor);
      self::fail('Claiming a frozen ticket must throw.');
    }
    catch (ClaimConflictException $e) {
      self::assertStringContainsString('frozen', $e->getMessage());
    }

    $runs = $this->container->get('entity_type.manager')->getStorage('bb_run')
      ->getQuery()->accessCheck(FALSE)->condition('ticket_id', $ticket->id())->execute();
    self::assertSame([], $runs, 'A refused claim creates no run.');
  }

  /**
   * The freeze also holds for an UNCLASSIFIED ticket (AC-3).
   *
   * This is the case clearing conductor_id does not cover: without a workflow
   * the ticket is a qualification candidate any conductor of the project may
   * claim, so assertConductorAssignment returns early for it.
   */
  public function testFrozenUnclassifiedTicketIsRefused(): void {
    $ticket = $this->seedUnclassifiedTicket();
    $ticket->setFrozen(TRUE)->save();

    $this->expectException(ClaimConflictException::class);
    $this->expectExceptionMessage('claim_conflict: ticket is frozen.');
    $this->claimService->claim($ticket, $this->conductor);
  }

  /**
   * The claimNext candidate query never returns a frozen ticket (AC-4).
   */
  public function testClaimNextSkipsFrozenTickets(): void {
    $frozen = $this->seedAssignedTicket('coding');
    $frozen->setFrozen(TRUE)->save();

    self::assertNull($this->claimService->claimNext($this->conductor));
  }

  /**
   * A backlog of frozen tickets cannot starve a claimable one (AC-4).
   *
   * More frozen tickets than CANDIDATE_LIMIT (50) are seeded so that they sit
   * AHEAD of the claimable one in the candidate window's own ordering
   * (`changed DESC, id DESC`; a kernel test's request time is frozen, so the
   * tiebreak `id DESC` decides and the frozen backlog must therefore be created
   * AFTER the claimable ticket). A PHP-side filter would fill the bounded
   * window with those frozen rows and return NULL despite eligible work; the
   * query-level condition keeps the window populated by live candidates only.
   */
  public function testFrozenTicketsDoNotConsumeTheCandidateWindow(): void {
    $claimable = $this->seedAssignedTicket('coding', 'GL-WINDOW-CLAIMABLE');
    for ($i = 0; $i < 55; $i++) {
      $noise = $this->seedAssignedTicket('coding', 'GL-WINDOW-FROZEN-' . $i);
      $noise->setFrozen(TRUE)->save();
    }

    $run = $this->claimService->claimNext($this->conductor);
    self::assertNotNull($run, 'A claimable ticket behind a frozen backlog is still reached.');
    self::assertSame((int) $claimable->id(), (int) $run->get('ticket_id')->target_id);
  }

  /**
   * Clearing frozen makes the ticket claimable again, with no other write.
   *
   * AC-6: the release is the single field write and nothing else — no
   * re-assignment, so the ticket is claimed by the same conductor it was
   * already assigned to.
   */
  public function testClearingFrozenRestoresCandidacy(): void {
    $ticket = $this->seedAssignedTicket('coding');
    $ticket->setFrozen(TRUE)->save();
    $whileFrozen = $this->claimService->claimNext($this->conductor);
    self::assertNull($whileFrozen, 'A frozen ticket is not a candidate.');

    $ticket->setFrozen(FALSE)->save();

    $run = $this->claimService->claimNext($this->conductor);
    self::assertNotNull($run, 'The next cycle claims it again.');
    self::assertSame((int) $ticket->id(), (int) $run->get('ticket_id')->target_id);
    self::assertSame((int) $this->conductor->id(), (int) $run->get('conductor_id')->target_id);
  }

  /**
   * Clearing `frozen` with an explicit NULL stores FALSE, not SQL NULL (AC-6).
   *
   * A JSON:API write of `"frozen": null` would otherwise leave a row that
   * `frozen = 0` never matches: unclaimable, yet reading as not frozen.
   */
  public function testClearingFrozenWithNullRestoresCandidacy(): void {
    $ticket = $this->seedAssignedTicket('coding');
    $ticket->setFrozen(TRUE)->save();

    $ticket->set('frozen', NULL)->save();

    $stored = \Drupal::database()->select('bb_ticket', 't')
      ->fields('t', ['frozen'])
      ->condition('id', $ticket->id())
      ->execute()
      ->fetchField();
    self::assertNotNull($stored, 'The column holds 0, not NULL.');
    self::assertSame(0, (int) $stored);
    $run = $this->claimService->claimNext($this->conductor);
    self::assertNotNull($run, 'The next cycle claims it again.');
    self::assertSame((int) $ticket->id(), (int) $run->get('ticket_id')->target_id);
  }

  /**
   * Freezing a ticket does not retire, kill or interrupt its active run (AC-5).
   *
   * Freeze bites at the NEXT claim. Release stays server-owned: the agent ends
   * its step with the state write and TicketTransitionSubscriber retires the
   * run, exactly as before. The conductor's load is unchanged, so its capacity
   * accounting cannot drift because an operator frozen something.
   */
  public function testFreezingDoesNotDisturbAnActiveRun(): void {
    $ticket = $this->seedAssignedTicket('coding');

    $run = $this->claimService->claim($ticket, $this->conductor);
    $loadBefore = (int) $this->conductor->get('reported_load')->value;

    $ticket->setFrozen(TRUE)->save();

    self::assertSame('claimed', $this->reloadRun($run)->getRunState(), 'The run is not retired by a freeze.');

    $conductors = $this->container->get('entity_type.manager')->getStorage('bb_conductor');
    $conductors->resetCache([$this->conductor->id()]);
    $conductor = $conductors->load($this->conductor->id());
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    self::assertSame(
      $loadBefore,
      (int) $conductor->get('reported_load')->value,
      'reported_load is unchanged by a freeze.',
    );
  }

  /**
   * Creates a saved unclassified ticket: no workflow, no state, no conductor.
   *
   * ClaimKernelTestBase only seeds classified, conductor-assigned tickets, so
   * the unclassified fixture AC-3 needs is built here. The project is read back
   * off the shared conductor so both stay in the same project.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved unclassified ticket.
   */
  private function seedUnclassifiedTicket(): BbTicketInterface {
    $identifier = 'GL-UNCLASSIFIED-' . mt_rand();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => $identifier,
        'title' => $identifier,
        'project_id' => (int) $this->conductor->get('project_id')->target_id,
        // Intentionally no 'workflow' and no 'state' — unclassified ticket.
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

}
