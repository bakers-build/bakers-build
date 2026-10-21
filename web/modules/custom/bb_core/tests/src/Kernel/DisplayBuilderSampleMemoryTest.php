<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Plugin\Context\EntityContext;
use Drupal\display_builder\Entity\Instance;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Builder state stores sample identity rather than an entire reference graph.
 */
#[Group('bb_core')]
final class DisplayBuilderSampleMemoryTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system', 'user', 'field', 'file', 'image', 'options', 'text', 'link', 'entity',
    'og', 'state_machine', 'ui_patterns', 'display_builder', 'bb_core',
  ];

  /**
   * Samples stay small in storage and are regenerated when the builder reads.
   */
  public function testSampleContextIsCompactAndRehydrated(): void {
    $this->installEntitySchema('user');
    $users = $this->container->get('entity_type.manager')->getStorage('user');
    $sample = $users->create(['name' => str_repeat('x', 1024 * 1024)]);
    $instance = Instance::create([
      'id' => 'memory-test',
      'profileId' => 'default',
      'contexts' => ['entity' => EntityContext::fromEntity($sample)],
    ]);
    $instance->save();
    $data = $this->container->get('state')->get('display_builder_memory-test');
    self::assertLessThan(20000, strlen(serialize($data)));
    self::assertSame(1024 * 1024, strlen((string) $sample->label()), 'The original preview entity is untouched.');
    $restored = $instance->getContexts()['entity']->getContextValue();
    self::assertSame('user', $restored->getEntityTypeId());
    self::assertNotEmpty($restored->label(), 'The generator restores sample field values for preview.');
  }

}
