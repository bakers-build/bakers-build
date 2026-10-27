<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * Nothing in bb_core/config/install depends on config bb_core cannot ship.
 *
 * `ConfigInstaller::installDefaultConfig()` checks every file in a module's
 * `config/install` against `checkConfigurationToInstall()`, which resolves each
 * `dependencies.config` AND each `dependencies.enforced.config` name against
 * the config that will exist once the module is installed — the active store
 * plus the module's own `config/install`. A name it cannot resolve is an
 * `UnmetDependenciesException` and the module install FAILS.
 *
 * That is the plain module-install path: every `KernelTestBase` calling
 * `installConfig(['bb_core'])`, every `BrowserTestBase` naming the module, and
 * any site enabling it. The term bundles (`bb_core.bb_vocabulary.*`) ship
 * only from `config/sync/**` and `recipes/bakers/config/**`, never from the
 * module, so a file here naming one is unsatisfiable.
 *
 * Measured on BB-421: the two create form displays carried
 * `dependencies.enforced.config` on the term bundles and
 * the whole functional suite reported 96 errors, every one of them
 *
 *   Drupal\Core\Config\UnmetDependenciesException: Configuration objects
 *   provided by bb_core have unmet dependencies:
 *   core.entity_form_display.bb_project.bb_project.create
 *   (bb_core.bb_vocabulary.label)
 *
 * The edge existed to force a recipe install order; the real defect it worked
 * around was `BbVocabulary` not being a `ConfigEntityBundleBase`, which
 * `BbVocabularyBundleCacheTest` now pins directly. This class is what stops
 * the workaround coming back.
 *
 * Asserted over the WHOLE directory rather than the two known files, because
 * the failure is a property of the placement and the next file to acquire such
 * an edge has not been written yet.
 *
 * Runs without a bootstrapped site: the directory is resolved from __DIR__.
 */
#[Group('bb_core')]
final class ModuleConfigInstallDependencyTest extends UnitTestCase {

  /**
   * Every config dependency named in config/install resolves on that path.
   */
  public function testConfigInstallNamesNoUnshippableDependency(): void {
    $directory = $this->repositoryRoot() . '/web/modules/custom/bb_core/config/install';
    $files = glob($directory . '/*.yml') ?: [];
    self::assertNotEmpty($files, 'bb_core still ships config/install.');

    $shipped = array_map(
      static fn (string $file): string => basename($file, '.yml'),
      $files,
    );

    foreach ($files as $file) {
      $data = Yaml::parseFile($file);
      self::assertIsArray($data);
      $declared = array_merge(
        $data['dependencies']['config'] ?? [],
        $data['dependencies']['enforced']['config'] ?? [],
      );
      foreach ($declared as $name) {
        self::assertContains(
          $name,
          $shipped,
          sprintf(
            '%s depends on the config object %s, which bb_core/config/install does not ship, so enabling bb_core throws UnmetDependenciesException.',
            basename($file),
            $name,
          ),
        );
      }
    }
  }

  /**
   * Resolves the repository root from this file's own location.
   *
   * The walk is tests/src/Unit -> src -> tests -> bb_core -> custom ->
   * modules -> web -> the repository root: seven levels.
   */
  private function repositoryRoot(): string {
    return dirname(__DIR__, 7);
  }

}
