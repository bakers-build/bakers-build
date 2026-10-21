<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Resource\ClaimNextResource;
use Drupal\jsonapi\JsonApiResource\JsonApiDocumentTopLevel;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;

/**
 * Capacity refusals remain visible when reported load understates occupancy.
 */
#[Group('bb_core')]
final class ClaimCapacityResponseTest extends ClaimKernelTestBase {

  /**
   * Full occupancy blocks repeated polls and explains the admission count.
   */
  public function testCapacityReasonSurvivesRepeatedPolls(): void {
    $now = 1789651238;
    $time = $this->createMock(TimeInterface::class);
    $time->method('getRequestTime')->willReturnCallback(static function () use (&$now): int {
      return $now;
    });
    $this->container->set('datetime.time', $time);
    $this->container->set('bb_core.ticket_claim', NULL);
    $this->claimService = $this->container->get('bb_core.ticket_claim');
    $etm = $this->container->get('entity_type.manager');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_machine');
    $machine = $etm->getStorage('bb_machine')->create([
      'name' => 'capacity',
      'host_key' => 'capacity',
      'owner_user_id' => $this->conductor->get('owner_user_id')->target_id,
      'max_parallel' => 9,
      'current_load' => 7,
    ]);
    $machine->save();
    $this->conductor->set('machine', $machine->id())->save();
    $sibling = $this->conductor->createDuplicate();
    $sibling->set('conductor_id', 'offline-sibling')->set('status', 'offline')->save();
    $target = $this->seedAssignedTicket('review', 'CAPACITY-TARGET');
    for ($i = 0; $i < 9; $i++) {
      $ticket = $this->seedAssignedTicket('coding', 'CAPACITY-' . $i);
      $run = $this->seedRun($ticket, 'coding', 'running', 1);
      if ($i >= 7) {
        $ticket->set('conductor_id', $sibling->id())->save();
        $run->set('conductor_id', $sibling->id())->save();
      }
    }
    $owner = $this->conductor->get('owner_user_id')->entity;
    $this->assertInstanceOf(AccountInterface::class, $owner);
    $resource = new ClaimNextResource($etm, $owner, $this->claimService);
    $request = Request::create('/jsonapi/bakers/claim-next', 'POST', [], [], [], [],
      json_encode(['data' => ['attributes' => ['conductor_id' => 'node-base']]], JSON_THROW_ON_ERROR));
    for ($poll = 0; $poll < 2; $poll++) {
      $response = $resource->process($request);
      $this->assertSame(200, $response->getStatusCode());
      $document = $response->getResponseData();
      $this->assertInstanceOf(JsonApiDocumentTopLevel::class, $document);
      $this->assertSame([
        'reason' => 'machine_capacity',
        'occupancy' => 9,
        'capacity' => 9,
        'retry_at' => NULL,
      ], $document->getMeta()['claim']);
      $this->assertCount(0, $document->getData());
      $now += 6;
    }
    // A full machine alone must not manufacture an eligible-work refusal.
    // Write `closed` on the column: an entity save would cancel the ticket
    // and closeIfTerminal() would re-close it on the reopen save.
    $this->writeClosedColumn($target, TRUE);
    $this->assertSame(204, $resource->process($request)->getStatusCode());
    $this->writeClosedColumn($target, FALSE);
    $run->setRunState('done')->save();
    $claimed = $this->claimService->claimNext($this->conductor);
    $this->assertNotNull($claimed);
    $this->assertSame((int) $target->id(), $claimed->getTicketId());
    $this->assertSame(204, $resource->process($request)->getStatusCode());
  }

  /**
   * Sets the raw `closed` column without running entity preSave.
   */
  private function writeClosedColumn(BbTicketInterface $ticket, bool $closed): void {
    $this->container->get('database')->update('bb_ticket')
      ->fields(['closed' => $closed ? 1 : 0])
      ->condition('id', $ticket->id())
      ->execute();
    $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->resetCache([(int) $ticket->id()]);
  }

}
