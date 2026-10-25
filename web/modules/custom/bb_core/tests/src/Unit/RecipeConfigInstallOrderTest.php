<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Core\Config\Entity\ConfigDependencyManager;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * Pins the order in which the bakers recipe creates its configuration.
 *
 * The `bakers` recipe creates ALL of its configuration in ONE call —
 * `RecipeConfigInstaller::installRecipeConfig()`, reached from
 * `RecipeRunner::processConfiguration()` — and that call orders the whole set
 * with `ConfigDependencyManager::sortAll()`, which sorts by graph weight and
 * then alphabetically. There is no phase boundary inside it: the recipe's own
 * `config/**` and every name under `config: import:` are one batch.
 *
 * That matters because saving a `core.entity_view_display.*` that carries
 * `third_party_settings.display_builder` is not inert.
 * `display_builder_entity_view`'s `EntityViewDisplay::postSave()` calls
 * `initInstanceIfMissing()`, which asks ui_patterns' `SampleEntityGenerator`
 * for a sample entity of the displayed type — and the generator recurses
 * through every entity-reference field, so a sample `bb_ticket` needs the
 * term bundles to EXIST. If the display sorts before the vocabulary
 * that declares that bundle, the save throws `Missing entity bundle` and the
 * whole recipe aborts, so `ddev init --provider recipe-test` fails on the
 * FIRST application.
 *
 * The displays cannot discover that edge: the vocabulary is a dependency of
 * the SAMPLE entity, not of the display, so `calculateDependencies()` has
 * nothing to find. `dependencies.enforced.config` is therefore the only lever,
 * and it is the same one `display_builder_page_layout.page_layout.bb_shell`
 * already uses for `display_builder.profile.default`.
 *
 * IT COVERS VIEW DISPLAYS ONLY, and the boundary is a measurement rather than
 * an oversight — one that BB-421 got wrong first and then corrected, so the
 * account is written out here in full.
 *
 * BB-421 mid-flight widened this class to form displays too, on the
 * following reasoning: a form display generates no sample entity, but
 * `EntityDisplayBase::preSave()` calls `init()`, which asks
 * `entity_field.manager` for the target bundle's field and extra-field
 * definitions, and that resolves through
 * `EntityTypeBundleInfo::getAllBundleInfo()` — which computes and CACHES the
 * bundles of EVERY entity type in one pass. So a form display sorting before
 * the vocabulary freezes `bb_term`'s bundle list, and a LATER view display's
 * sample entity reads the frozen answer and aborts with `Missing entity
 * bundle. The "label" bundle does not exist` — at the view display, with
 * nothing in the trace pointing at the form display. Measured then: adding the
 * create-project pair put `core.entity_form_display.bb_project.bb_project
 * .create` at index 5 and the vocabulary at 8, and `ddev init --provider
 * recipe-test` died at `core.entity_view_display.bb_run.bb_run.teaser`.
 * `dependencies.enforced.config` on both form displays fixed it.
 *
 * ALL OF THAT DESCRIBES THE SYMPTOM CORRECTLY AND NAMES THE WRONG LEVER. The
 * defect is not the sort order: it is that `BbVocabulary` extended
 * `ConfigEntityBase` and not `ConfigEntityBundleBase`, so creating a bundle
 * never reached `EntityBundleListener::onBundleCreate()` and never called
 * `clearCachedBundles()`. Measured as a Kernel test rather than argued —
 * `BbVocabularyBundleCacheTest` primed the cache, saved a vocabulary and
 * found the bundle still absent, and it found the same for a vocabulary saved
 * BEFORE anything of ours primed the cache, because `installEntitySchema()`
 * primes it in `setUp()`. Three failures, one cause.
 *
 * And the enforced edge on a FORM display was not merely redundant, it was
 * actively broken, which is what forced the correction. Both form displays ship
 * from `bb_core/config/install` (spec D10), the vocabulary ships only from
 * `config/sync/**` and `recipes/bakers/config/**`, and
 * `ConfigInstaller::checkConfigurationToInstall()` resolves `enforced` names
 * like any other — so the edge is unsatisfiable on the plain module-install
 * path. The whole functional suite reported 96 errors, every one of them
 * `UnmetDependenciesException: Configuration objects provided by bb_core have
 * unmet dependencies: core.entity_form_display.bb_project.bb_project.create
 * (bb_core.bb_vocabulary.label)`. `BbVocabulary extends
 * ConfigEntityBundleBase` made the edge unnecessary and it was deleted from
 * both copies of both files; `ModuleConfigInstallDependencyTest` is what stops
 * it — or anything like it — coming back.
 *
 * So a VIEW display still needs the edge and this class still pins it: its
 * sample entity needs the term bundles to EXIST at its own save time,
 * which no cache invalidation can supply. A FORM display needs nothing: it
 * primes the cache, and the vocabulary's own save now clears whatever it
 * primed, wherever the two sort relative to each other.
 *
 * Asserted here rather than left to `ddev init`, because the alternative is
 * exactly what BB-413 hit: an alphabetical adjacency that held until three
 * unrelated names joined the recipe's storage and moved it.
 *
 * Runs without a bootstrapped site: the recipe and the module directories are
 * resolved from __DIR__.
 */
#[Group('bb_core')]
final class RecipeConfigInstallOrderTest extends UnitTestCase {

  /**
   * Config that must exist before any sample entity is generated.
   *
   * The ticket display and every display whose entity carries a `ticket_id`
   * reference (`bb_run`, `bb_comment`) reach `bb_ticket`, whose
   * `ticket_type`, `recipe` and `labels` fields restrict `target_bundles` to
   * `type`, `recipe` and `label`.
   *
   * @var array<string>
   */
  private const BUNDLE_CONFIG_NAMES = [
    'bb_core.bb_vocabulary.label',
    'bb_core.bb_vocabulary.recipe',
    'bb_core.bb_vocabulary.type',
  ];

  /**
   * The name prefixes of config whose save needs the bundle to already EXIST.
   *
   * View displays only. A view display carrying
   * `third_party_settings.display_builder` generates a sample entity, and the
   * generator asks for a bundle that has to be there — an existence
   * requirement, which is why the edge is the only lever. A form display
   * merely PRIMES the bundle-info cache, and since `BbVocabulary extends
   * ConfigEntityBundleBase` the vocabulary's own save clears whatever it
   * primed; it must NOT carry the edge, because it ships from
   * `bb_core/config/install` where the vocabulary is unreachable. The class
   * docblock records the measurement, and
   * `ModuleConfigInstallDependencyTest` pins the other side of it.
   *
   * Used only for the ORDER assertion below, which is harmless to apply
   * broadly: a display sorting after a bundle it never reads costs nothing.
   * The ENFORCE assertion is scoped tighter, by
   * `DISPLAYS_REACHING_TICKET_LABELS` below — see that constant for why.
   *
   * @var array<string>
   */
  private const DISPLAY_PREFIXES = [
    'core.entity_view_display.',
  ];

  /**
   * The displays whose sample entity actually reaches the term bundles.
   *
   * NOT every `core.entity_view_display.*` needs the enforced edge, and
   * BB-484 is the measurement that proved it: `core.entity_view_mode.bb_
   * team.full` carries `third_party_settings.display_builder` too, so it
   * generates a sample `bb_team`, but `bb_team`'s only entity-reference
   * base field is `projects` (target `bb_project`), and `BbProject` in
   * turn references `bb_group`, `bb_team`, `bb_environment` and `user`
   * — never `bb_ticket`. The recursion the class docblock describes simply
   * never reaches `bb_ticket.labels`, so the sample generator never asks
   * for the term bundles, and `ddev init --provider recipe-test`
   * measured the display building without the edge. Enforcing it anyway
   * would assert a dependency that costs nothing but describes nothing true,
   * which is exactly the kind of unmeasured edge BB-421's docblock warns
   * against adding by pattern-matching rather than by measurement — so it is
   * named here, absent, rather than added.
   *
   * @var array<string>
   */
  private const DISPLAYS_REACHING_TICKET_LABELS = [
    'core.entity_view_display.bb_comment.bb_comment.full',
    'core.entity_view_display.bb_comment.review.full',
    'core.entity_view_display.bb_comment.bb_comment.teaser',
    'core.entity_view_display.bb_comment.review.teaser',
    'core.entity_view_display.bb_run.bb_run.full',
    'core.entity_view_display.bb_run.bb_run.overlay',
    'core.entity_view_display.bb_run.bb_run.teaser',
    'core.entity_view_display.bb_ticket.bb_ticket.full',
    // A template's term fields target the term bundles, as a ticket's do.
    'core.entity_form_display.bb_ticket_template.bb_ticket_template.default',
    'core.entity_view_display.bb_ticket_template.bb_ticket_template.default',
  ];

  /**
   * The displays whose sample entity is measured NOT to reach the term bundles.
   *
   * Exempt from the order assertion below, for the reason
   * `DISPLAYS_REACHING_TICKET_LABELS` gives for exempting the team display
   * from the enforce assertion: making them sort after the vocabulary needs an
   * enforced edge that describes nothing true. BB-587 measured the group:
   * `bb_group` references only `bb_workspace` and `user`, which in turn
   * reference only `user` and `user_role`, none with `target_bundles`. The
   * team display passed the order assertion without the edge only because its
   * `enforced.module: [og]` raises its graph weight — an accident, not the
   * property, so it is named here beside the group. BB-619 measured the
   * conductor the same way: `project_id` reaches `bb_project`, which never
   * reaches `bb_ticket.labels`.
   *
   * @var array<string>
   */
  private const DISPLAYS_NOT_REACHING_TICKET_LABELS = [
    'core.entity_view_display.bb_conductor.bb_conductor.full',
    'core.entity_view_display.bb_group.bb_group.full',
    'core.entity_view_display.bb_machine.bb_machine.full',
    'core.entity_view_display.bb_project.bb_project.epics',
    'core.entity_view_display.bb_project.bb_project.full',
    'core.entity_view_display.bb_team.bb_team.full',
  ];

  /**
   * Every other entity display the recipe creates sorts after both bundles.
   */
  public function testEntityDisplaysSortAfterTheirSampleEntityBundles(): void {
    $data = $this->recipeConfigData();
    $order = array_flip((new ConfigDependencyManager())->setData($data)->sortAll());

    $displays = array_filter(
      array_keys($data),
      fn (string $name): bool => $this->isDisplay($name)
        && !in_array($name, self::DISPLAYS_NOT_REACHING_TICKET_LABELS, TRUE),
    );
    self::assertNotEmpty($displays, 'The bakers recipe still ships entity displays.');

    foreach (self::BUNDLE_CONFIG_NAMES as $bundle_name) {
      self::assertArrayHasKey($bundle_name, $order, "$bundle_name is in the recipe's config storage.");
      foreach ($displays as $display_name) {
        self::assertLessThan(
          $order[$display_name],
          $order[$bundle_name],
          "$bundle_name is created before $display_name, so the sample entity built while saving the display finds its bundle.",
        );
      }
    }
  }

  /**
   * Every display that reaches `bb_ticket` declares the edge for it.
   *
   * The order above is the property; this is the mechanism. Without a declared
   * edge the order is an alphabetical accident that the next name added to the
   * recipe can move — which is how BB-413 broke. BB-421 read the same
   * symptom one display kind further along and reached for the same lever; the
   * class docblock records why that was the wrong one there and right here.
   *
   * Scoped to `DISPLAYS_REACHING_TICKET_LABELS` rather than every
   * `core.entity_view_display.*` — BB-484 added a fourth display
   * (`bb_team.bb_team.full`) whose sample entity never reaches
   * `bb_ticket.labels`, so asserting the edge on it would pin a dependency
   * that describes nothing measured.
   */
  public function testEntityDisplaysEnforceTheBundleDependency(): void {
    $data = $this->recipeConfigData();
    $displays = array_filter(
      $data,
      fn (array $values, string $name): bool => in_array($name, self::DISPLAYS_REACHING_TICKET_LABELS, TRUE),
      ARRAY_FILTER_USE_BOTH,
    );
    self::assertCount(
      count(self::DISPLAYS_REACHING_TICKET_LABELS),
      $displays,
      'The bakers recipe still ships every display named in DISPLAYS_REACHING_TICKET_LABELS.',
    );

    foreach ($displays as $name => $values) {
      $declared = array_merge(
        $values['dependencies']['config'] ?? [],
        $values['dependencies']['enforced']['config'] ?? [],
      );
      foreach (self::BUNDLE_CONFIG_NAMES as $bundle_name) {
        self::assertContains(
          $bundle_name,
          $declared,
          "$name declares a config dependency on $bundle_name.",
        );
      }
    }
  }

  /**
   * The team display enforces R1's edge, not R3's (measured, not assumed).
   *
   * `og_group` is the only view-configurable field on `bb_team`, and it is
   * registered as an OG group only by this recipe's `actions:` block, which
   * runs AFTER `config:`. Left alone that makes the display's calculated
   * `dependencies.module` a function of install order — `["bb_core"]` on
   * the recipe path, `["bb_core", "og"]` on the CIM path — and the fix is
   * `dependencies.enforced.module: [og]`, which `recipes/bakers/recipe.yml`'s
   * rewritten R1 comment names. This is the other half of the same
   * measurement `testEntityDisplaysEnforceTheBundleDependency()` uses to
   * exempt this display from R3's edge: the two hazards are independent, and
   * this display carries exactly one of them.
   */
  public function testTeamDisplayEnforcesTheOgModuleDependency(): void {
    $data = $this->recipeConfigData();
    $name = 'core.entity_view_display.bb_team.bb_team.full';
    self::assertArrayHasKey($name, $data, 'The bakers recipe ships the team display.');

    $enforced_modules = $data[$name]['dependencies']['enforced']['module'] ?? [];
    self::assertContains(
      'og',
      $enforced_modules,
      "$name enforces a module dependency on og, so both install paths save the same calculated module set.",
    );

    $declared = array_merge(
      $data[$name]['dependencies']['config'] ?? [],
      $data[$name]['dependencies']['enforced']['config'] ?? [],
    );
    foreach (self::BUNDLE_CONFIG_NAMES as $bundle_config) {
      self::assertNotContains(
        $bundle_config,
        $declared,
        "$name's sample entity never reaches bb_ticket, so it must not carry an edge that describes nothing measured.",
      );
    }
  }

  /**
   * Whether a config name is a display whose save needs the bundle to exist.
   *
   * @param string $name
   *   The config name.
   *
   * @return bool
   *   TRUE when saving it generates a sample entity of the displayed type.
   */
  private function isDisplay(string $name): bool {
    foreach (self::DISPLAY_PREFIXES as $prefix) {
      if (str_starts_with($name, $prefix)) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Reads the whole config set the bakers recipe's storage exposes.
   *
   * Mirrors `ConfigConfigurator::getConfigStorage()`: the recipe's own
   * `config/` directory takes priority over the extensions', and an extension
   * contributes only the names the `config: import:` list allows, resolved
   * through its `config/install` and then its `config/optional`.
   *
   * @return array<string, array<mixed>>
   *   The config data, keyed by config name.
   */
  private function recipeConfigData(): array {
    $root = $this->repositoryRoot();
    $recipe = Yaml::parseFile($root . '/recipes/bakers/recipe.yml');
    self::assertIsArray($recipe);

    $data = [];
    foreach ($recipe['config']['import'] ?? [] as $extension => $names) {
      if (!is_array($names)) {
        // '*' would need the extension lists, and the bakers recipe never uses
        // it. Fail loudly rather than measure a subset silently.
        self::fail("The bakers recipe imports '$names' from $extension; this test only understands an explicit list.");
      }
      $extension_path = $this->extensionPath($root, $extension);
      foreach ($names as $name) {
        $file = NULL;
        foreach (['config/install', 'config/optional'] as $directory) {
          $candidate = $extension_path . '/' . $directory . '/' . $name . '.yml';
          if (file_exists($candidate)) {
            $file = $candidate;
            break;
          }
        }
        self::assertNotNull($file, "$extension ships $name in config/install or config/optional.");
        $data[$name] = Yaml::parseFile($file);
      }
    }

    foreach (glob($root . '/recipes/bakers/config/*.yml') ?: [] as $file) {
      $data[basename($file, '.yml')] = Yaml::parseFile($file);
    }

    return $data;
  }

  /**
   * Resolves an extension's path without a bootstrapped extension list.
   *
   * @param string $root
   *   The repository root.
   * @param string $extension
   *   The extension's machine name.
   *
   * @return string
   *   The absolute path to the extension.
   */
  private function extensionPath(string $root, string $extension): string {
    foreach (['web/modules/custom', 'web/modules/contrib', 'web/themes/custom'] as $directory) {
      $candidate = $root . '/' . $directory . '/' . $extension;
      if (is_dir($candidate)) {
        return $candidate;
      }
    }
    // Submodules nest inside their parent, e.g. bb_core/modules/bb_api_key.
    $nested = glob($root . '/web/modules/custom/*/modules/' . $extension, GLOB_ONLYDIR) ?: [];
    if ($nested !== []) {
      return $nested[0];
    }
    self::fail("Could not resolve the path of the '$extension' extension.");
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
