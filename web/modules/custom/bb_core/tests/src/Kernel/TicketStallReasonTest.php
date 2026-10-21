<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Claim\TicketStallReason;
use Drupal\bb_core\Entity\BbTicketInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers the stall-reason resolver (BB-302, AC-8).
 *
 * Four operator-facing labels plus the fixed priority between them: frozen >
 * blocked > no conductor > failing, with a live run short-circuiting to no
 * reason at all. `running` is live regardless of lease; `claimed` only with a
 * live lease.
 */
#[Group('bb_core')]
final class TicketStallReasonTest extends ClaimKernelTestBase {

  /**
   * The resolver under test.
   */
  private TicketStallReason $reasons;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->reasons = $this->container->get('bb_core.ticket_stall_reason');
  }

  /**
   * A healthy assigned ticket is not standing still.
   */
  public function testAssignedTicketHasNoReason(): void {
    $ticket = $this->seedAssignedTicket('coding');
    self::assertSame('', $this->reasons->reasonFor($ticket));
  }

  /**
   * A classified ticket with no conductor names that.
   */
  public function testUnassignedClassifiedTicket(): void {
    $ticket = $this->seedUnassignedTicket();
    self::assertSame('no conductor', $this->reasons->reasonFor($ticket));
  }

  /**
   * An unclassified ticket is not standing still for want of a conductor.
   */
  public function testUnclassifiedTicketIsNotUnassigned(): void {
    $ticket = $this->seedUnclassifiedTicket();
    self::assertSame('', $this->reasons->reasonFor($ticket));
  }

  /**
   * Open blockers are named.
   */
  public function testBlockedTicket(): void {
    $ticket = $this->seedBlockedTicket($this->seedAssignedTicket('coding', 'GL-STALL-BLOCKER'));
    self::assertSame('blocked', $this->reasons->reasonFor($ticket));
  }

  /**
   * A tripped circuit breaker is named.
   */
  public function testBreakerTicket(): void {
    $ticket = $this->seedAssignedTicket('diagnose');
    $this->tripTheBreaker($ticket);
    self::assertSame('failing', $this->reasons->reasonFor($this->reloadTicket($ticket)));
  }

  /**
   * The stall badge uses the wait tone so the reason is visible.
   */
  public function testStallBadgeUsesTheWaitTone(): void {
    self::assertSame(
      [
        'label' => 'frozen',
        'tone' => 'wait',
        'dot' => TRUE,
        'icon' => '',
        'suffix' => '',
      ],
      TicketStallReason::badge('frozen'),
    );
  }

  /**
   * A frozen stall carries the hold's age as the badge suffix.
   */
  public function testFrozenBadgeSuffixNamesWhenTheHoldStarted(): void {
    $started = $this->container->get('datetime.time')->getRequestTime() - 120;
    $badge = TicketStallReason::badge('frozen', $started);
    self::assertSame('frozen', $badge['label']);
    self::assertSame('2 minutes ago', $badge['suffix']);
    self::assertSame(
      'just now',
      TicketStallReason::badge(
        'frozen',
        $this->container->get('datetime.time')->getRequestTime(),
      )['suffix'],
    );
    self::assertSame(
      '',
      TicketStallReason::badge('blocked', $started)['suffix'],
      'Only a frozen stall carries the timestamp.',
    );
  }

  /**
   * Freeze wins over every other reason.
   */
  public function testFrozenWinsOverBlocked(): void {
    $ticket = $this->seedBlockedTicket($this->seedAssignedTicket('coding', 'GL-STALL-P-BLOCKER'));
    $ticket->setFrozen(TRUE)->save();
    self::assertSame('frozen', $this->reasons->reasonFor($ticket));
  }

  /**
   * Open blockers win over a missing conductor.
   */
  public function testBlockedWinsOverUnassigned(): void {
    $blocker = $this->seedAssignedTicket('coding', 'GL-STALL-B-U-BLOCKER');
    $ticket = $this->seedBlockedTicket($blocker, $this->seedUnassignedTicket());
    self::assertSame('blocked', $this->reasons->reasonFor($ticket));
  }

  /**
   * A missing conductor wins over a tripped breaker.
   */
  public function testUnassignedWinsOverBreaker(): void {
    $ticket = $this->seedUnassignedTicket();
    $this->tripTheBreaker($ticket);
    self::assertSame('no conductor', $this->reasons->reasonFor($this->reloadTicket($ticket)));
  }

  /**
   * A ticket with an active run is not standing still at all.
   */
  public function testTicketWithActiveRunHasNoReason(): void {
    $ticket = $this->seedAssignedTicket('coding');
    $this->claimService->claim($ticket, $this->conductor);
    self::assertSame('', $this->reasons->reasonFor($this->reloadTicket($ticket)));
  }

  /**
   * A deliberate freeze is reported even while a run is still finishing.
   *
   * The active-run short circuit sits BELOW the freeze check on purpose: the
   * operator's intent is the answer to "why will this stand still", and the run
   * itself is untouched (AC-5, asserted by ClaimFrozenTest).
   */
  public function testFrozenWinsOverAnActiveRun(): void {
    $ticket = $this->seedAssignedTicket('coding');
    $this->claimService->claim($ticket, $this->conductor);
    $ticket = $this->reloadTicket($ticket);
    $ticket->setFrozen(TRUE)->save();
    self::assertSame('frozen', $this->reasons->reasonFor($ticket));
  }

  /**
   * A LAPSED claimed run does not hide the reason the ticket is standing still.
   */
  public function testLapsedClaimedRunDoesNotHideTheReason(): void {
    $blocker = $this->seedAssignedTicket('coding', 'GL-STALL-LAPSED-BLOCKER');
    $ticket = $this->seedBlockedTicket($blocker);
    $expired = $this->container->get('datetime.time')->getRequestTime() - 60;
    $this->seedRun($ticket, 'coding', 'claimed', $expired);
    self::assertSame('blocked', $this->reasons->reasonFor($this->reloadTicket($ticket)));
  }

  /**
   * A run whose lease still holds keeps the short circuit intact.
   */
  public function testUnexpiredRunStillShortCircuits(): void {
    $blocker = $this->seedAssignedTicket('coding', 'GL-STALL-LIVE-BLOCKER');
    $ticket = $this->seedBlockedTicket($blocker);
    $this->seedRun($ticket, 'coding', 'running');
    self::assertSame('', $this->reasons->reasonFor($this->reloadTicket($ticket)));
  }

  /**
   * A running run is live even when its lease has lapsed.
   */
  public function testRunningWithLapsedLeaseStillShortCircuits(): void {
    $blocker = $this->seedAssignedTicket('coding', 'GL-STALL-RUNNING-LAPSED-BLOCKER');
    $ticket = $this->seedBlockedTicket($blocker);
    $expired = $this->container->get('datetime.time')->getRequestTime() - 60;
    $this->seedRun($ticket, 'coding', 'running', $expired);
    self::assertSame('', $this->reasons->reasonFor($this->reloadTicket($ticket)));
  }

  /**
   * A finished ticket is not standing still, whatever else holds for it.
   */
  #[DataProvider('terminalStates')]
  public function testTerminalTicketHasNoReason(string $state): void {
    $ticket = $this->seedUnassignedTicket($state);
    $this->tripTheBreaker($ticket);
    $ticket = $this->reloadTicket($ticket);
    self::assertSame('', $this->reasons->reasonFor($ticket));
    $ticket->setFrozen(TRUE)->save();
    self::assertSame('', $this->reasons->reasonFor($ticket));
    // Saving closes a terminal ticket, which would hide the state check.
    \Drupal::database()->update('bb_ticket')
      ->fields(['closed' => 0])
      ->condition('id', $ticket->id())
      ->execute();
    $ticket = $this->reloadTicket($ticket);
    self::assertFalse($ticket->isClosed());
    self::assertSame('', $this->reasons->reasonFor($ticket), 'The terminal state alone settles it.');
  }

  /**
   * Terminal states of the unassigned-ticket workflow.
   *
   * @return array<string, array{string}>
   *   One case per terminal state.
   */
  public static function terminalStates(): array {
    return ['done' => ['done'], 'cancelled' => ['cancelled']];
  }

  /**
   * A closed ticket is not standing still, even in a claimable state.
   */
  public function testClosedTicketHasNoReason(): void {
    $ticket = $this->seedUnassignedTicket();
    $ticket->set('closed', TRUE)->save();
    self::assertSame('', $this->reasons->reasonFor($ticket));
  }

  /**
   * Creates a saved classified ticket with no conductor assigned.
   *
   * @param string $state
   *   The state to create it in.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved ticket.
   */
  private function seedUnassignedTicket(string $state = 'qualification'): BbTicketInterface {
    $identifier = 'GL-STALL-UNASSIGNED-' . mt_rand();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => $identifier,
        'workflow' => 'bb_bug',
        'state' => $state,
        'title' => $identifier,
        'project_id' => (int) $this->conductor->get('project_id')->target_id,
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Creates a saved classified ticket with no workflow and no conductor.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved unclassified ticket.
   */
  private function seedUnclassifiedTicket(): BbTicketInterface {
    $identifier = 'GL-STALL-UNCLASSIFIED-' . mt_rand();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => $identifier,
        'title' => $identifier,
        'project_id' => (int) $this->conductor->get('project_id')->target_id,
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Points a ticket's blocked_by at an open blocker and saves it.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $blocker
   *   The blocking ticket; it is left in a non-terminal state, so it is open.
   * @param \Drupal\bb_core\Entity\BbTicketInterface|null $ticket
   *   The ticket to block; a fresh assigned ticket when omitted.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved blocked ticket.
   */
  private function seedBlockedTicket(BbTicketInterface $blocker, ?BbTicketInterface $ticket = NULL): BbTicketInterface {
    $ticket ??= $this->seedAssignedTicket('coding');
    $ticket->set('blocked_by', [$blocker->id()]);
    $ticket->save();
    return $ticket;
  }

  /**
   * Seeds enough recent failed runs to trip the failed-run circuit breaker.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket whose runs should trip the breaker.
   */
  private function tripTheBreaker(BbTicketInterface $ticket): void {
    $changed = $this->container->get('datetime.time')->getRequestTime() - 600;
    for ($i = 0; $i < 3; $i++) {
      $run = $this->seedRun($ticket, 'diagnose', 'failed');
      $this->container->get('database')->update('bb_run')
        ->fields(['changed' => $changed])
        ->condition('id', $run->id())
        ->execute();
    }
  }

}
