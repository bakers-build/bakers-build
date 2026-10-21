<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Unit;

use Drupal\Component\Utility\SortArray;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * The shipped activity row display keeps the bakers recipe's config contracts.
 *
 * The same two contracts bb_core's ConfigCopyDriftTest and
 * RecipeConfigInstallOrderTest assert for its own displays.
 */
#[Group('bb_activity')]
final class ActivityConfigContractTest extends UnitTestCase {

  /**
   * The activity row display, `bb_theme:event`.
   */
  private const DISPLAY = 'core.entity_view_display.bb_activity.bb_activity.full';

  /**
   * The recipe copy and the config/sync export of the display agree.
   */
  public function testRecipeCopyIsStructurallyIdentical(): void {
    $recipe = Yaml::parseFile($this->repositoryRoot() . '/recipes/bakers/config/' . self::DISPLAY . '.yml');
    $sync = Yaml::parseFile($this->repositoryRoot() . '/config/sync/' . self::DISPLAY . '.yml');
    self::assertIsArray($recipe);
    self::assertIsArray($sync);
    self::assertArrayNotHasKey('uuid', $recipe);
    self::assertArrayNotHasKey('_core', $recipe);
    unset($sync['uuid'], $sync['_core']);
    SortArray::sortByKeyRecursive($recipe);
    SortArray::sortByKeyRecursive($sync);
    self::assertSame($sync, $recipe);
  }

  /**
   * The display reaches bb_ticket.labels and enforces its bundle config.
   */
  public function testDisplayEnforcesTheTicketLabelsBundleDependency(): void {
    $recipe = Yaml::parseFile($this->repositoryRoot() . '/recipes/bakers/config/' . self::DISPLAY . '.yml');
    self::assertIsArray($recipe);
    $declared = array_merge(
      $recipe['dependencies']['config'] ?? [],
      $recipe['dependencies']['enforced']['config'] ?? [],
    );
    self::assertContains('bb_core.bb_vocabulary.bb_labels', $declared);
  }

  /**
   * The repository root, seven levels above this file's directory.
   */
  private function repositoryRoot(): string {
    return dirname(__DIR__, 7);
  }

}
