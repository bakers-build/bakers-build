<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Utility\SortArray;
use Drupal\Core\Config\FileStorage;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The shipped catalog form displays are stored in their saved form.
 *
 * A second recipe application compares each shipped file with the active
 * config; a file the entity rewrites on save aborts the recipe.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CatalogFormDisplayShippedTest extends KernelTestBase {

  /**
   * The shipped config, in the order the recipe creates it.
   */
  private const NAMES = [
    'entity_vocabulary' => [
      'bb_core.bb_vocabulary.type',
      'bb_core.bb_vocabulary.recipe',
      'bb_core.bb_vocabulary.label',
    ],
    'entity_form_mode' => ['core.entity_form_mode.bb_environment.add'],
    'entity_form_display' => [
      'core.entity_form_display.bb_term.type.default',
      'core.entity_form_display.bb_term.recipe.default',
      'core.entity_form_display.bb_term.label.default',
      'core.entity_form_display.bb_environment.bb_environment.default',
      'core.entity_form_display.bb_environment.bb_environment.add',
    ],
  ];

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'island', 'bb_core',
  ];

  /**
   * Saving a shipped catalog form config does not rewrite it.
   */
  public function testShippedConfigDoesNotDriftOnSave(): void {
    $source = new FileStorage(dirname(DRUPAL_ROOT) . '/recipes/bakers/config');
    $manager = $this->container->get('config.manager');
    foreach (self::NAMES as $names) {
      foreach ($names as $name) {
        $data = $source->read($name);
        self::assertIsArray($data, "$name is shipped.");
        $entity_type = $manager->getEntityTypeIdByName($name);
        self::assertNotNull($entity_type, $name);
        $this->container->get('entity_type.manager')->getStorage($entity_type)->create($data)->save();
      }
    }

    // The vocabularies are only the bundles the term displays need.
    foreach ([...self::NAMES['entity_form_mode'], ...self::NAMES['entity_form_display']] as $name) {
      $stored = $this->config($name)->getRawData();
      // The normalisation core's ConfigConfigurator applies before it decides
      // a recipe's config collides with the active config.
      unset($stored['uuid'], $stored['_core']);
      $shipped = $source->read($name);
      self::assertIsArray($shipped);
      SortArray::sortByKeyRecursive($stored);
      SortArray::sortByKeyRecursive($shipped);
      self::assertSame($shipped, $stored, "$name did not drift on save.");
    }
  }

}
