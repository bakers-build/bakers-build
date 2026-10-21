<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies bb_core registers the node_edit_form theme hook.
 *
 * Gin renders its two-column meta sidebar on content forms by setting
 * $form['#theme'] = ['node_edit_form'] (GinContentFormHelper). The
 * node_edit_form theme hook is registered only by the node module, which bakers.build
 * does not enable. Without the hook the #theme resolves to nothing, the sidebar
 * collapses inline, and the meta sidebar is "missing". bb_core registers the
 * hook itself so Gin's node-edit-form template override applies node-free.
 *
 * @see \Drupal\bb_core\Hook\GinIntegrationHooks::theme()
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class GinNodeEditFormThemeTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * The node_edit_form theme hook is registered without the node module.
   */
  public function testNodeEditFormThemeHookRegistered(): void {
    $this->assertFalse(
      $this->container->get('module_handler')->moduleExists('node'),
      'The node module must not be enabled for this test to be meaningful.',
    );
    $registry = $this->container->get('theme.registry')->get();
    $this->assertArrayHasKey(
      'node_edit_form',
      $registry,
      'bb_core must register the node_edit_form theme hook so Gin renders the meta sidebar node-free.',
    );
    $this->assertSame('form', $registry['node_edit_form']['render element']);
  }

}
