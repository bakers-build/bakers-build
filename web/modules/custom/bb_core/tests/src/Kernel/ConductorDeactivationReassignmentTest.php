<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Database\Database;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\Sql\SqlEntityStorageInterface;
use Drupal\bb_core\Conductor\ConductorDeactivationReassigner;
use Drupal\bb_core\Entity\BbConductorInterface;
use PHPUnit\Framework\Attributes\Group;
use Psr\Log\AbstractLogger;

/**
 * Tests synchronous ticket reassignment on conductor deactivation.
 */
#[Group('bb_core')]
final class ConductorDeactivationReassignmentTest extends ClaimKernelTestBase {

  /**
   * A matching active sibling receives the ticket.
   */
  public function testSingleCandidateTakesTheTickets(): void {
    $candidate = $this->createCandidate('candidate');
    $ticket = $this->seedAssignedTicket('working');
    $this->conductor->set('active', FALSE)->save();

    self::assertSame((int) $candidate->id(), (int) $this->reloadTicket($ticket)->get('conductor_id')->target_id);
  }

  /**
   * The newest matching sibling wins.
   */
  public function testNewestLastSeenWins(): void {
    $this->createCandidate('old', 100);
    $newest = $this->createCandidate('new', 200);
    $ticket = $this->seedAssignedTicket('working');
    $this->conductor->set('active', FALSE)->save();

    self::assertSame((int) $newest->id(), (int) $this->reloadTicket($ticket)->get('conductor_id')->target_id);
  }

  /**
   * No matching sibling leaves the ticket unassigned.
   */
  public function testNoCandidateClearsTheAssignment(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->conductor->set('active', FALSE)->save();

    self::assertNull($this->reloadTicket($ticket)->get('conductor_id')->target_id);
  }

  /**
   * A terminal ticket keeps its record of who did the work.
   */
  public function testTerminalTicketIsNotTouched(): void {
    $this->createCandidate('candidate');
    // The shared fixture walks no further than `review`, so the terminal edge
    // is applied here.
    $ticket = $this->seedAssignedTicket('review');
    $ticket->getState()->applyTransitionById('finish');
    $ticket->save();
    self::assertSame('done', (string) $this->reloadTicket($ticket)->get('state')->value);

    $this->conductor->set('active', FALSE)->save();

    self::assertSame(
      (int) $this->conductor->id(),
      (int) $this->reloadTicket($ticket)->get('conductor_id')->target_id,
    );
  }

  /**
   * A run already under way finishes where it started.
   */
  public function testTicketWithRunInFlightStays(): void {
    $this->createCandidate('candidate');
    $ticket = $this->seedAssignedTicket('working');
    $this->seedRun($ticket, 'working', 'running');
    $this->conductor->set('active', FALSE)->save();

    self::assertSame(
      (int) $this->conductor->id(),
      (int) $this->reloadTicket($ticket)->get('conductor_id')->target_id,
    );
  }

  /**
   * A lease-expired `claimed` run is a zombie, not an in-flight run.
   *
   * `TicketClaimService::countLiveRunsOnMachine()` and `retireSupersededRuns()`
   * both already treat a `claimed` run past its lease as dead. The reassigner
   * must use the same predicate, or a ticket whose conductor died mid-claim
   * and was then deactivated is stranded on it forever (F9).
   */
  public function testTicketWithLeaseExpiredClaimedRunReassigns(): void {
    $candidate = $this->createCandidate('candidate');
    $ticket = $this->seedAssignedTicket('working');
    $now = $this->container->get('datetime.time')->getRequestTime();
    $this->seedRun($ticket, 'working', 'claimed', $now - 60);
    $this->conductor->set('active', FALSE)->save();

    self::assertSame(
      (int) $candidate->id(),
      (int) $this->reloadTicket($ticket)->get('conductor_id')->target_id,
    );
  }

  /**
   * A skipped ticket is named in the log, not silently dropped (F10).
   */
  public function testSkippedTicketIsLogged(): void {
    $this->createCandidate('candidate');
    $ticket = $this->seedAssignedTicket('working');
    $this->seedRun($ticket, 'working', 'running');

    $logger = $this->capturingLogger();
    $reassigner = new ConductorDeactivationReassigner(
      $this->container->get('entity_type.manager'),
      $logger,
      $this->container->get('datetime.time'),
      $this->container->get('bb_core.conductor_owner_access'),
    );

    $reassigner->reassign($this->conductor);

    self::assertNotEmpty(array_filter(
      $logger->messages(),
      static fn (string $message): bool => str_contains($message, (string) $ticket->id()),
    ));
  }

  /**
   * A terminal ticket does not appear in the log, only the in-flight one (F15).
   */
  public function testTerminalTicketIsNotLoggedButInFlightOneIs(): void {
    $this->createCandidate('candidate');
    $inFlight = $this->seedAssignedTicket('working');
    $this->seedRun($inFlight, 'working', 'running');
    $terminal = $this->seedAssignedTicket('review');
    $terminal->getState()->applyTransitionById('finish');
    $terminal->save();
    self::assertSame('done', (string) $this->reloadTicket($terminal)->get('state')->value);

    $logger = $this->capturingLogger();
    $reassigner = new ConductorDeactivationReassigner(
      $this->container->get('entity_type.manager'),
      $logger,
      $this->container->get('datetime.time'),
      $this->container->get('bb_core.conductor_owner_access'),
    );

    $reassigner->reassign($this->conductor);

    $notice = implode("\n", $logger->messages());
    self::assertStringContainsString((string) $inFlight->id(), $notice);
    self::assertStringNotContainsString((string) $terminal->id(), $notice);
  }

  /**
   * A projectless ticket is reported as stranded, not skipped silently (F16).
   */
  public function testTicketWithoutProjectIsLogged(): void {
    $projectless = $this->seedAssignedTicket('working');
    $projectless->set('project_id', NULL)->save();

    $logger = $this->capturingLogger();
    $reassigner = new ConductorDeactivationReassigner(
      $this->container->get('entity_type.manager'),
      $logger,
      $this->container->get('datetime.time'),
      $this->container->get('bb_core.conductor_owner_access'),
    );

    $reassigner->reassign($this->conductor);

    self::assertNotEmpty(array_filter(
      $logger->messages(),
      static fn (string $message): bool => str_contains($message, (string) $projectless->id()),
    ));
  }

  /**
   * The candidate query narrows to non-terminal tickets before loading (F14).
   *
   * The terminal ticket's id must never appear as a query argument once the
   * narrowing runs — a per-row `loadMultiple()` followed by a PHP discard
   * would still touch it.
   */
  public function testTerminalTicketNeverLoaded(): void {
    $this->createCandidate('candidate');
    $nonTerminal = $this->seedAssignedTicket('working');
    $nonTerminalId = (string) $nonTerminal->id();
    $terminal = $this->seedAssignedTicket('review');
    $terminal->getState()->applyTransitionById('finish');
    $terminal->save();
    self::assertSame('done', (string) $this->reloadTicket($terminal)->get('state')->value);
    $terminalId = (string) $terminal->id();

    $reassigner = new ConductorDeactivationReassigner(
      $this->container->get('entity_type.manager'),
      $this->container->get('logger.factory')->get('bb_core'),
      $this->container->get('datetime.time'),
      $this->container->get('bb_core.conductor_owner_access'),
    );

    Database::startLog('conductor_deactivation_narrowing');
    $reassigner->reassign($this->conductor);
    $log = Database::getLog('conductor_deactivation_narrowing');

    // Scoped to a SELECT against the ticket's own base table: small
    // sequential test ids collide across entity types (a conductor and a
    // ticket can share the same numeric id), so matching every argument of
    // every query would produce false positives unrelated to this table.
    $ticketSelectsContaining = static function (array $log, string $ticketId): array {
      return array_filter($log, static function (array $entry) use ($ticketId): bool {
        $query = ltrim((string) $entry['query']);
        if (!str_starts_with($query, 'SELECT') || !str_contains($query, '"bb_ticket"')) {
          return FALSE;
        }
        foreach ($entry['args'] ?? [] as $value) {
          $values = is_array($value) ? $value : [$value];
          foreach ($values as $single) {
            if ((string) $single === $ticketId) {
              return TRUE;
            }
          }
        }
        return FALSE;
      });
    };
    // Positive control (N2): the filter must be able to match *something* —
    // otherwise a driver quoting or prefixing the table name differently
    // would make the terminal assertion below pass vacuously, for a reason
    // unrelated to the narrowing it claims to prove.
    self::assertNotCount(
      0,
      $ticketSelectsContaining($log, $nonTerminalId),
      'The filter must match the non-terminal ticket, or it cannot be trusted to catch the terminal one.',
    );
    self::assertCount(
      0,
      $ticketSelectsContaining($log, $terminalId),
      'The terminal ticket must never be queried or loaded.',
    );
    self::assertSame(
      (int) $this->conductor->id(),
      (int) $this->reloadTicket($terminal)->get('conductor_id')->target_id,
    );
  }

  /**
   * A row whose `state` is SQL NULL still survives the narrowing (N3/O2).
   *
   * `addNonTerminalCondition()` admits a NULL `state`/`workflow` through an
   * `OR`, exactly so a row like this is not silently dropped from the
   * candidate query. Without that branch this ticket would never even reach
   * the in-memory tie-break and would stay stranded on the deactivated
   * conductor forever.
   */
  public function testNullStateRowSurvivesTheNarrowing(): void {
    $candidate = $this->createCandidate('candidate');
    $ticket = $this->seedAssignedTicket('working');
    \Drupal::database()->update('bb_ticket')
      ->fields(['state' => NULL])
      ->condition('id', $ticket->id())
      ->execute();

    $this->conductor->set('active', FALSE)->save();

    self::assertSame(
      (int) $candidate->id(),
      (int) $this->reloadTicket($ticket)->get('conductor_id')->target_id,
    );
  }

  /**
   * A save failure is reported under its own notice, not the stranded one.
   */
  public function testForcedSaveFailureIsLoggedUnderItsOwnNotice(): void {
    $this->createCandidate('candidate');
    $ticket = $this->seedAssignedTicket('working');

    $entityTypeManager = $this->container->get('entity_type.manager');
    $reflection = new \ReflectionObject($entityTypeManager);
    $property = $reflection->getProperty('handlers');
    $property->setAccessible(TRUE);
    $handlers = $property->getValue($entityTypeManager);
    $handlers['storage']['bb_ticket'] = new FailingSaveStorageDecorator(
      $handlers['storage']['bb_ticket'],
      (int) $ticket->id(),
    );
    $property->setValue($entityTypeManager, $handlers);

    $logger = $this->capturingLogger();
    $reassigner = new ConductorDeactivationReassigner(
      $entityTypeManager,
      $logger,
      $this->container->get('datetime.time'),
      $this->container->get('bb_core.conductor_owner_access'),
    );

    $reassigner->reassign($this->conductor);

    $notice = implode("\n", $logger->messages());
    self::assertStringContainsString((string) $ticket->id(), $notice);
    self::assertStringContainsString('reassignment save failed', $notice);
    self::assertStringNotContainsString('in-flight run or no project', $notice);
  }

  /**
   * Creates a logger that captures every interpolated message (F15/F16).
   */
  private function capturingLogger(): MessageCapturingLogger {
    return new MessageCapturingLogger();
  }

  /**
   * Another account's conductor is no candidate.
   */
  public function testForeignOwnerIsNoCandidate(): void {
    $foreign = $this->createCandidate('foreign');
    $other = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'other-owner', 'status' => 1]);
    $other->save();
    $foreign->set('owner_user_id', $other->id())->save();
    $ticket = $this->seedAssignedTicket('working');
    $this->conductor->set('active', FALSE)->save();

    self::assertNull($this->reloadTicket($ticket)->get('conductor_id')->target_id);
  }

  /**
   * A ticket with no project does not strand the rest of the batch.
   */
  public function testTicketWithoutProjectDoesNotStrandTheBatch(): void {
    $candidate = $this->createCandidate('candidate');
    $projectless = $this->seedAssignedTicket('working');
    $projectless->set('project_id', NULL)->save();
    $normal = $this->seedAssignedTicket('working');

    $this->conductor->set('active', FALSE)->save();

    self::assertSame(
      (int) $this->conductor->id(),
      (int) $this->reloadTicket($projectless)->get('conductor_id')->target_id,
    );
    self::assertSame(
      (int) $candidate->id(),
      (int) $this->reloadTicket($normal)->get('conductor_id')->target_id,
    );
  }

  /**
   * Two candidates sharing `last_seen` resolve by the `id` tie-break (F18).
   */
  public function testTiedLastSeenResolvesByHighestId(): void {
    $sameLastSeen = 150;
    $first = $this->createCandidate('tied-first', $sameLastSeen);
    $second = $this->createCandidate('tied-second', $sameLastSeen);
    $ticket = $this->seedAssignedTicket('working');
    $this->conductor->set('active', FALSE)->save();

    $winner = (int) $first->id() > (int) $second->id() ? $first : $second;
    self::assertSame(
      (int) $winner->id(),
      (int) $this->reloadTicket($ticket)->get('conductor_id')->target_id,
    );
  }

  /**
   * Creates an active conductor for the shared owner and project.
   */
  private function createCandidate(string $id, ?int $lastSeen = NULL): BbConductorInterface {
    $candidate = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $id,
      'label' => $id,
      'owner_user_id' => $this->conductor->get('owner_user_id')->target_id,
      'project_id' => $this->conductor->get('project_id')->target_id,
      'status' => 'offline',
      'states' => ['plan', 'working'],
      'last_seen' => $lastSeen ?? $this->container->get('datetime.time')->getRequestTime(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $candidate);
    $candidate->save();
    return $candidate;
  }

}

/**
 * Delegates every call to a real `bb_ticket` storage, except `save()`.
 *
 * `save()` throws `EntityStorageException` for one chosen ticket id and
 * delegates otherwise, so a test can force the exact failure
 * `ConductorDeactivationReassigner::reassignOne()` catches, without touching
 * DB-level constraints sqlite does not enforce (O3).
 */
final class FailingSaveStorageDecorator implements SqlEntityStorageInterface {

  public function __construct(
    private readonly SqlEntityStorageInterface $inner,
    private readonly int $failingId,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public function getTableMapping(?array $storage_definitions = NULL) {
    return $this->inner->getTableMapping($storage_definitions);
  }

  /**
   * {@inheritdoc}
   */
  public function save(EntityInterface $entity) {
    if ((int) $entity->id() === $this->failingId) {
      throw new EntityStorageException('Forced failure for test.');
    }
    return $this->inner->save($entity);
  }

  /**
   * {@inheritdoc}
   */
  public function resetCache(?array $ids = NULL): void {
    $this->inner->resetCache($ids);
  }

  /**
   * {@inheritdoc}
   */
  public function loadMultiple(?array $ids = NULL) {
    return $this->inner->loadMultiple($ids);
  }

  /**
   * {@inheritdoc}
   */
  public function load($id) {
    return $this->inner->load($id);
  }

  /**
   * {@inheritdoc}
   */
  public function loadUnchanged($id) {
    return $this->inner->loadUnchanged($id);
  }

  /**
   * {@inheritdoc}
   */
  public function loadByProperties(array $values = []) {
    return $this->inner->loadByProperties($values);
  }

  /**
   * {@inheritdoc}
   */
  public function create(array $values = []) {
    return $this->inner->create($values);
  }

  /**
   * {@inheritdoc}
   */
  public function delete(array $entities): void {
    $this->inner->delete($entities);
  }

  /**
   * {@inheritdoc}
   */
  public function restore(EntityInterface $entity): void {
    $this->inner->restore($entity);
  }

  /**
   * {@inheritdoc}
   */
  public function hasData() {
    return $this->inner->hasData();
  }

  /**
   * {@inheritdoc}
   */
  public function getQuery($conjunction = 'AND') {
    return $this->inner->getQuery($conjunction);
  }

  /**
   * {@inheritdoc}
   */
  public function getAggregateQuery($conjunction = 'AND') {
    return $this->inner->getAggregateQuery($conjunction);
  }

  /**
   * {@inheritdoc}
   */
  public function getEntityTypeId() {
    return $this->inner->getEntityTypeId();
  }

  /**
   * {@inheritdoc}
   */
  public function getEntityType() {
    return $this->inner->getEntityType();
  }

  /**
   * {@inheritdoc}
   */
  public function getEntityClass(?string $bundle = NULL): string {
    return $this->inner->getEntityClass($bundle);
  }

}

/**
 * A PSR-3 logger that captures every interpolated message, for assertions.
 */
final class MessageCapturingLogger extends AbstractLogger {

  /**
   * Every message logged so far, interpolated.
   *
   * @var array<int, string>
   */
  private array $messages = [];

  /**
   * {@inheritdoc}
   */
  public function log(mixed $level, string|\Stringable $message, array $context = []): void {
    $this->messages[] = strtr((string) $message, array_map(
      static fn ($value): string => (string) $value,
      $context,
    ));
  }

  /**
   * Returns every message logged so far, interpolated.
   *
   * @return array<int, string>
   *   Every message logged so far, interpolated.
   */
  public function messages(): array {
    return $this->messages;
  }

}
