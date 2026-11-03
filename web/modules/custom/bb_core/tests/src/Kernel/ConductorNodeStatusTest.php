<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbConductorInterface;

/**
 * Tests the conductor node liveness derivation (BB-450 D12/AC-20).
 *
 * The never-reported case is the one this ticket fixes: a conductor whose
 * registration set `status: online` (the JSON:API upsert path always does)
 * but which never got as far as a heartbeat — a refused registration, for
 * instance — used to read `online` because the stale check was gated on
 * `last_seen > 0` and skipped entirely when no heartbeat had ever arrived.
 * BB-281 Finding 3 observed exactly such records in the field.
 */
final class ConductorNodeStatusTest extends BbEntityKernelTestBase {

  /**
   * Creates a bb_project entity and returns its ID.
   */
  private function makeProject(string $name): int {
    $p = \Drupal::entityTypeManager()->getStorage('bb_project')->create(['name' => $name]);
    $p->save();
    return (int) $p->id();
  }

  /**
   * Creates a bb_conductor entity with the given status/last_seen.
   */
  private function makeConductor(string $machine, int $project, string $status, ?int $lastSeen): BbConductorInterface {
    $values = [
      'label' => $machine,
      'project_id' => $project,
      'status' => $status,
    ];
    if ($lastSeen !== NULL) {
      $values['last_seen'] = $lastSeen;
    }
    $c = \Drupal::entityTypeManager()->getStorage('bb_conductor')->create($values);
    $c->save();
    $this->assertInstanceOf(BbConductorInterface::class, $c);
    return $c;
  }

  /**
   * A never-reported record derives 'stale', not 'online'.
   *
   * Even though its own status attribute says 'online', which is exactly
   * what a registerConductor() upsert writes regardless of whether a
   * heartbeat ever follows.
   */
  public function testNeverReportedDerivesStaleNotOnline(): void {
    $project = $this->makeProject('P');
    $conductor = $this->makeConductor('m-never', $project, 'online', NULL);
    $status = \Drupal::service('bb_core.conductor_deriver')->nodeStatus($conductor);
    $this->assertSame('stale', $status);
  }

  /**
   * A fresh heartbeat derives 'online'.
   */
  public function testFreshHeartbeatDerivesOnline(): void {
    $project = $this->makeProject('P');
    $now = \Drupal::time()->getRequestTime();
    $conductor = $this->makeConductor('m-fresh', $project, 'online', $now);
    $status = \Drupal::service('bb_core.conductor_deriver')->nodeStatus($conductor);
    $this->assertSame('online', $status);
  }

  /**
   * A heartbeat older than the 600s threshold derives 'stale'.
   */
  public function testLapsedHeartbeatDerivesStale(): void {
    $project = $this->makeProject('P');
    $now = \Drupal::time()->getRequestTime();
    $conductor = $this->makeConductor('m-lapsed', $project, 'online', $now - 900);
    $status = \Drupal::service('bb_core.conductor_deriver')->nodeStatus($conductor);
    $this->assertSame('stale', $status);
  }

  /**
   * A self-declared offline status derives 'offline', not 'stale'.
   *
   * When the heartbeat is still within the window — a graceful stop right
   * after a heartbeat should read as offline, not stale.
   */
  public function testSelfDeclaredOfflineDerivesOffline(): void {
    $project = $this->makeProject('P');
    $now = \Drupal::time()->getRequestTime();
    $conductor = $this->makeConductor('m-offline', $project, 'offline', $now);
    $status = \Drupal::service('bb_core.conductor_deriver')->nodeStatus($conductor);
    $this->assertSame('offline', $status);
  }

  /**
   * An unset last_seen timestamp renders Never on the product Overview.
   */
  public function testNeverReportedLastSeenLabelIsNever(): void {
    $project = $this->makeProject('P');
    $conductor = $this->makeConductor('m-never-seen', $project, 'online', NULL);
    $label = \Drupal::service('bb_core.conductor_deriver')->lastSeenLabel($conductor);
    $this->assertSame('Never', $label);
  }

}
