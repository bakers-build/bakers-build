<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * A state's `approval` outside the vocabulary fails loudly.
 */
#[Group('bb_core')]
final class WorkflowApprovalVocabularyTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'field', 'og',
    'bb_core', 'state_machine', 'entity', 'user', 'options', 'text', 'link',
    'facets', 'bb_workflow_approval_test',
  ];

  /**
   * The message names the workflow and the state, for the YAML line to fix.
   */
  public function testUnknownApprovalThrows(): void {
    $this->expectException(\LogicException::class);
    $this->expectExceptionMessageMatches('/"open".*"bb_approval_test"/');
    TypeWorkflows::approval('bb_approval_test', 'open');
  }

  /**
   * A state that declares no approval is human.
   */
  public function testAbsentApprovalIsHuman(): void {
    $this->assertSame('human', TypeWorkflows::approval('bb_approval_test', 'closed'));
  }

}
