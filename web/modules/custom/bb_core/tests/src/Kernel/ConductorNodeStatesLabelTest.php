<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbConductorInterface;

/**
 * Tests the conductor node "served states" label.
 *
 * The `states` list is an optional narrowing (BB-207): an empty/absent list
 * means the conductor serves every claimable state in its project, so the label
 * must read "all claimable states" — never a blank cell that reads as "none".
 */
final class ConductorNodeStatesLabelTest extends BbEntityKernelTestBase {

  /**
   * Creates a bb_project entity and returns its ID.
   */
  private function makeProject(string $name): int {
    $p = \Drupal::entityTypeManager()->getStorage('bb_project')->create(['name' => $name]);
    $p->save();
    return (int) $p->id();
  }

  /**
   * Creates a bb_conductor entity with the given states list.
   */
  private function makeConductor(string $machine, int $project, array $states): BbConductorInterface {
    $c = \Drupal::entityTypeManager()->getStorage('bb_conductor')->create([
      'label' => $machine,
      'project_id' => $project,
      'states' => $states,
    ]);
    $c->save();
    $this->assertInstanceOf(BbConductorInterface::class, $c);
    return $c;
  }

  /**
   * An empty states list renders "all claimable states", not a blank cell.
   */
  public function testEmptyStatesRendersAllClaimableLabel(): void {
    $project = $this->makeProject('P');
    $conductor = $this->makeConductor('m-empty', $project, []);
    $label = \Drupal::service('bb_core.conductor_deriver')
      ->nodeStatesLabel($conductor);
    $this->assertSame('all claimable states', $label);
  }

  /**
   * A non-empty states list renders the comma-separated states.
   */
  public function testNonEmptyStatesRendersList(): void {
    $project = $this->makeProject('P');
    $conductor = $this->makeConductor('m-list', $project, ['spec', 'coding']);
    $label = \Drupal::service('bb_core.conductor_deriver')
      ->nodeStatesLabel($conductor);
    $this->assertSame('spec, coding', $label);
  }

}
