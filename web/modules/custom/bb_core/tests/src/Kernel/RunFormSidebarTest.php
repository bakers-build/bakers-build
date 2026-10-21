<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the bb_run form's Footprint sidebar group (BB-132).
 *
 * The six conductor-written metric fields render in a collapsible "Footprint"
 * panel on the form's right side (like the Meta block), read-only — the panel
 * is for visibility, not manual editing.
 *
 * @see \Drupal\bb_core\Form\BbRunForm
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunFormSidebarTest extends KernelTestBase {

  private const METRIC_FIELDS = [
    'tokens',
    'duration_s',
    'agent_turns',
    'tool_calls',
    'user_prompts',
    'user_prompt_words',
    'active_s',
  ];

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'datetime', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['system']);
    foreach ([
      'user', 'og_membership',
      'bb_group',
      'bb_project',
      'bb_conductor',
      'bb_ticket',
      'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
  }

  /**
   * Builds the default form for a run.
   *
   * @return array<string, mixed>
   *   The built form render array.
   */
  private function buildForm(): array {
    $run = $this->container->get('entity_type.manager')
      ->getStorage('bb_run')
      ->create(['state' => 'done']);
    assert($run instanceof BbRunInterface);
    return $this->container->get('entity.form_builder')->getForm($run, 'default');
  }

  /**
   * The six metric fields live in the footprint group, read-only.
   */
  public function testFootprintGroupReadOnly(): void {
    $form = $this->buildForm();
    $this->assertArrayHasKey('footprint', $form, 'The Footprint group container exists.');
    foreach (self::METRIC_FIELDS as $field) {
      $this->assertArrayHasKey($field, $form, "The {$field} element is on the form.");
      $this->assertSame('footprint', $form[$field]['#group'], "{$field} is in the footprint group.");
      $this->assertTrue($form[$field]['#disabled'], "{$field} is read-only.");
    }
  }

}
