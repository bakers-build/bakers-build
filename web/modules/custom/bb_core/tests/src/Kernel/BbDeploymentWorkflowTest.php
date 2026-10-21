<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies the bb_deployment release workflow is registered (BB-140).
 *
 * The workflow adds the pre_deployment -> post_deployment -> done release
 * lifecycle. TypeWorkflows reads workflow plugins dynamically, so the workflow
 * YAML alone must make the states selectable + claimable — no PHP change.
 */
#[Group('bb_core')]
final class BbDeploymentWorkflowTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'field', 'og',
    'bb_core', 'state_machine', 'entity', 'user', 'options', 'text', 'link',
  ];

  /**
   * The workflow is registered in the ticket group with claimable states.
   */
  public function testDeploymentWorkflowRegistered(): void {
    $this->assertArrayHasKey('bb_deployment', TypeWorkflows::ticketWorkflowOptions());
    $this->assertTrue(TypeWorkflows::isClaimable('bb_deployment', 'pre_deployment'));
    $this->assertTrue(TypeWorkflows::isClaimable('bb_deployment', 'post_deployment'));
    $this->assertTrue(TypeWorkflows::isTerminal('bb_deployment', 'done'));
    $this->assertArrayHasKey('pre_deployment', TypeWorkflows::stateOptions());
    $this->assertArrayHasKey('post_deployment', TypeWorkflows::stateOptions());
  }

}
