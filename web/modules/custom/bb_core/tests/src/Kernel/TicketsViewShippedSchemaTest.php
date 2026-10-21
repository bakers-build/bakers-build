<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\Schema\SchemaCheckTrait;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * Both shipped copies of `views.view.tickets` validate against config schema.
 *
 * THIS FILE EXISTS BECAUSE A GATE WAS MISSING, and the gap it closes is
 * structural rather than incidental. BB-481 added two keys to the `my_work`
 * display — `defaults.menu: false` and `defaults.tab_options: false` — and
 * nothing this repository runs locally looked at them:
 *
 * - The project's PHPUnit check selects only the test classes a ticket
 *   created or changed, by path. The eleven classes that DID raise on those
 *   keys — `BbHomeControllerTest`, `BbRailMyWorkTest` and nine others —
 *   belong to no ticket in particular, so a path-selected run is silent about
 *   them by construction, and correctly so.
 * - `config_install` and `config_sync` were BOTH green on the same revision.
 *   Installing and importing configuration does not apply the strict schema
 *   validation `KernelTestBase::$strictConfigSchema` applies, so a config
 *   artifact can reach a site on both install paths and still be
 *   unschematisable. The two-path proof was never a statement about schema
 *   validity, and this file is what makes that property a measured one.
 *
 * The defect surfaced only in the CI `phpunit` job, at 98 errors across those
 * eleven classes and 1084 seconds — and only on the SECOND pipeline, because
 * the first one's test-stage jobs died on an image pull before `phpunit`
 * reported at all. This test answers the same question in milliseconds.
 *
 * WHY IT VALIDATES THE FILES RATHER THAN SAVING THE VIEW. Saving the entity is
 * what the eleven classes already do, and it is expensive:
 * `installShippedView()` needs the whole plugin-carrying module set booted,
 * and the classes that use it also stand up a search_api server and an entity
 * schema. Reading the two YAML files and handing them to
 * `checkConfigSchema()` exercises exactly the mechanism that raised —
 * `ConfigSchemaChecker` calls the same trait — with nothing else in the way,
 * and it reports the offending property path by name rather than as a stack
 * trace.
 *
 * WHY BOTH COPIES, and not just the one a test would load. The two-path rule
 * requires `config/sync/**` and the recipe's own `config/**` to agree, so a
 * schema defect is written into both by construction — as this one was, two
 * occurrences each. `installShippedView()` reads the RECIPE copy only, so the
 * sync copy is on no Kernel test's path at all and a defect there would reach
 * the server's config import unobserved. Asserting both is the only form in
 * which this file covers what it claims to.
 *
 * WHY ONLY THIS VIEW. Seven views ship from `recipes/bakers/config`, and every
 * one of them would be worth the same assertion — but each brings its own set
 * of schema-providing modules, and a provider left out of `$modules` reports
 * its own options as `missing schema`, which is a false failure wearing the
 * exact costume of a real one. Widening this file means widening that list
 * deliberately, one view at a time, rather than looping over a directory and
 * hoping.
 */
#[Group('bb_core')]
final class TicketsViewShippedSchemaTest extends KernelTestBase {

  use SchemaCheckTrait;

  /**
   * {@inheritdoc}
   *
   * The list `TicketsViewConfigTest` needs to SAVE the view, because it is the
   * same question: every module named in the view's `dependencies.module`
   * supplies schema for the options its plugins wrote, and one left out turns
   * its own subtree into `missing schema`. Nothing here is installed or saved,
   * so enabling them costs only their schema files and service definitions.
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'better_exposed_filters', 'facets', 'facets_exposed_filters',
    'views_filters_summary',
    'ui_patterns',
    'display_builder', 'ui_patterns_views', 'display_builder_views',
    'bb_core',
  ];

  /**
   * The two homes a config artifact of this project has.
   *
   * @return array<string, array{string}>
   *   Repository-relative paths, keyed by the install path they serve.
   */
  public static function shippedCopies(): array {
    return [
      'config/sync (CIM)' => ['config/sync/views.view.tickets.yml'],
      'recipes/bakers/config (recipe)' => ['recipes/bakers/config/views.view.tickets.yml'],
    ];
  }

  /**
   * A shipped copy carries no key the config schema cannot type.
   *
   * @param string $relative_path
   *   The copy's path below the repository root.
   */
  #[DataProvider('shippedCopies')]
  public function testEveryShippedCopyIsSchematisable(string $relative_path): void {
    // The repository root, from this file's own location: the module extension
    // list answers paths relative to the app root (`web/`), which cannot reach
    // `config/` or `recipes/` above it.
    $path = dirname(__DIR__, 7) . '/' . $relative_path;
    self::assertFileExists($path, "$relative_path is not shipped.");

    $data = Yaml::parseFile($path);
    self::assertIsArray($data, "$relative_path did not parse as a YAML mapping.");

    $result = $this->checkConfigSchema(
      $this->container->get('config.typed'),
      'views.view.tickets',
      $data,
    );

    self::assertNotFalse(
      $result,
      'views.view.tickets has no config schema at all, so nothing was checked.',
    );
    self::assertTrue(
      $result === TRUE,
      sprintf(
        "%s carries keys the config schema cannot type, so every Kernel test that installs it raises SchemaIncompleteException:\n%s",
        $relative_path,
        is_array($result) ? print_r($result, TRUE) : '',
      ),
    );
  }

}
