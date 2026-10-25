<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies the bb_verification post-deployment review workflow (BB-148).
 *
 * The bb_verification workflow re-verifies a subject ticket (parent_id) and
 * its linked tickets on a target environment (environments), filing bug tickets
 * (referenced_tickets) per regression. States: verifying -> summary -> done.
 * The state is a string, so the YAML alone registers the workflow — no PHP, no
 * schema hook.
 */
#[Group('bb_core')]
final class BbVerificationWorkflowTest extends KernelTestBase {

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
  public function testVerificationWorkflowRegistered(): void {
    $this->assertArrayHasKey('bb_verification', TypeWorkflows::ticketWorkflowOptions());
    $this->assertTrue(TypeWorkflows::isClaimable('bb_verification', 'verifying'));
    $this->assertTrue(TypeWorkflows::isClaimable('bb_verification', 'summary'));
    $this->assertTrue(TypeWorkflows::isTerminal('bb_verification', 'done'));
    $this->assertArrayHasKey('verifying', TypeWorkflows::stateOptions());
    $this->assertArrayHasKey('summary', TypeWorkflows::stateOptions());
  }

}
