<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Tests\bb_core\Kernel\Tool\BakersToolTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the computed `target_branch` field on bb_ticket.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TargetBranchFieldTest extends BakersToolTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_environment');
  }

  /**
   * Creates an environment of the actor's project.
   */
  private function environment(string $name, string $branch): int {
    $env = $this->container->get('entity_type.manager')->getStorage('bb_environment')->create([
      'name' => $name,
      'project_id' => $this->project->id(),
      'branch' => $branch,
    ]);
    $env->save();
    return (int) $env->id();
  }

  /**
   * A deployment ticket merges into its one environment's branch.
   */
  public function testDeploymentTargetsItsEnvironmentBranch(): void {
    $deployment = $this->term('type', 'deployment')->id();
    $ticket = $this->ticket('TB-1', [
      'ticket_type' => $deployment,
      'environments' => [$this->environment('production', 'stable')],
    ]);
    self::assertSame('main', $ticket->get('base_branch')->value);
    self::assertSame('stable', $ticket->get('target_branch')->value);
    $out = $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->getIdentifier()]));
    self::assertSame('stable', $out['target_branch']);
  }

  /**
   * Every other ticket merges into its base branch.
   */
  public function testOtherwiseTargetIsBaseBranch(): void {
    $deployment = $this->term('type', 'deployment')->id();
    $feature = $this->term('type', 'feature')->id();
    $staging = $this->environment('staging', 'staging');
    $cases = [
      'feature with an environment' => ['ticket_type' => $feature, 'environments' => [$staging]],
      'deployment without environment' => ['ticket_type' => $deployment],
      'deployment with two environments' => [
        'ticket_type' => $deployment,
        'environments' => [$staging, $this->environment('production', 'stable')],
      ],
      'deployment with a branchless environment' => [
        'ticket_type' => $deployment,
        'environments' => [$this->environment('preview', '')],
      ],
    ];
    $n = 0;
    foreach ($cases as $case => $values) {
      $ticket = $this->ticket('TB-O' . ++$n, $values);
      self::assertSame('main', $ticket->get('target_branch')->value, $case);
    }
  }

}
