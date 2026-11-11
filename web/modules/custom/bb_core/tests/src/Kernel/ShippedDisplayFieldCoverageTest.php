<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Every shipped entity display lists each display-configurable field.
 *
 * An installed display gains every unlisted display-configurable field under
 * `hidden`, so a shipped file that omits one no longer matches the installed
 * config and re-applying the recipe aborts.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ShippedDisplayFieldCoverageTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core', 'bb_activity',
  ];

  /**
   * Each shipped view and form display names all its configurable fields.
   */
  public function testShippedDisplaysListEveryConfigurableField(): void {
    $entity_type_manager = $this->container->get('entity_type.manager');
    $field_manager = $this->container->get('entity_field.manager');
    // No GLOB_BRACE: musl's PHP (the Alpine image) does not define it.
    $config = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $files = array_merge(
      glob($config . '/core.entity_view_display.*.yml') ?: [],
      glob($config . '/core.entity_form_display.*.yml') ?: [],
    );
    self::assertNotEmpty($files);

    $missing = [];
    foreach ($files as $file) {
      $display = Yaml::decode((string) file_get_contents($file));
      if (!$entity_type_manager->hasDefinition($display['targetEntityType'])) {
        continue;
      }
      $context = str_contains(basename($file), 'entity_form_display') ? 'form' : 'view';
      $listed = ($display['content'] ?? []) + ($display['hidden'] ?? []);
      $definitions = $field_manager->getFieldDefinitions($display['targetEntityType'], $display['bundle']);
      foreach ($definitions as $name => $definition) {
        if ($definition->isDisplayConfigurable($context) && !isset($listed[$name])) {
          $missing[] = basename($file, '.yml') . ': ' . $name;
        }
      }
    }
    self::assertSame([], $missing);
  }

}
