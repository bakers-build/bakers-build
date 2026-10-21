<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Claim\ClaimConflictException;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Pins that cancelled runs do not block ticket claims or the retry breaker.
 */
#[Group('bb_core')]
final class CancelledRunFreesTicketTest extends ClaimKernelTestBase {

  /**
   * A ticket with only a cancelled run is claimable again.
   */
  public function testTicketWithOnlyCancelledRunIsClaimableAgain(): void {
    $ticket = $this->seedAssignedTicket('diagnose');
    $run = $this->seedRun($ticket, 'diagnose', 'running');

    try {
      $this->claimService->claim($this->reloadTicket($ticket), $this->conductor);
    }
    catch (ClaimConflictException $exception) {
      self::assertStringContainsString('active run', $exception->getMessage());
    }
    $run->set('state', 'cancelled')->save();
    $claimed = $this->claimService->claim($this->reloadTicket($ticket), $this->conductor);
    self::assertSame('claimed', $claimed->getRunState());
  }

  /**
   * Cancelling one of the runs that parked a ticket breaks the all-failed set.
   */
  public function testCancellingOneFailedRunUnparksTheCircuitBreaker(): void {
    $ticket = $this->seedAssignedTicket('diagnose');
    $runs = [];
    for ($i = 0; $i < 3; $i++) {
      $runs[] = $this->seedFailedRun($ticket, $this->now() - 600);
    }

    try {
      $this->claimService->claim($this->reloadTicket($ticket), $this->conductor);
    }
    catch (ClaimConflictException $exception) {
      self::assertStringContainsString('ticket parked', $exception->getMessage());
    }
    $runs[2]->set('state', 'cancelled')->save();
    $claimed = $this->claimService->claim($this->reloadTicket($ticket), $this->conductor);
    self::assertSame('claimed', $claimed->getRunState());
  }

  /**
   * Seeds a failed run inside the retry window.
   */
  private function seedFailedRun(BbTicketInterface $ticket, int $changed): BbRunInterface {
    $run = $this->seedRun($ticket, 'diagnose', 'failed');
    $this->container->get('database')->update('bb_run')
      ->fields(['changed' => $changed])
      ->condition('id', $run->id())
      ->execute();
    return $this->reloadRun($run);
  }

  /**
   * Returns the request timestamp used by the breaker window.
   */
  private function now(): int {
    return $this->container->get('datetime.time')->getRequestTime();
  }

}
