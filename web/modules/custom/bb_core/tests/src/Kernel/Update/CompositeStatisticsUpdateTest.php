<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Update;

use Drupal\Core\Config\Schema\SchemaCheckTrait;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Statistics\CompositeStatisticsDefaults;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Yaml\Yaml;

/**
 * Covers shipped composite statistics config and upgrade migration.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CompositeStatisticsUpdateTest extends KernelTestBase {

  use SchemaCheckTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine', 'field', 'og',
    'link', 'text', 'bb_core',
  ];

  private const CONFIG_NAMES = [
    'bb_core.bb_measurement.closed_tickets',
    'bb_core.bb_measurement.runs',
    'bb_core.bb_measurement.tickets_per_run',
    'bb_core.bb_measurement.runs_per_ticket',
    'bb_core.bb_figure.project_overview',
    'bb_core.bb_figure.user_overview',
    'bb_core.bb_figure.user_projects',
    'bb_core.bb_figure.team_projects',
    'bb_core.bb_figure.team_members',
    'bb_core.bb_figure.team_user_overview',
    'bb_core.bb_figure.team_user_projects',
    'bb_core.bb_figure.user_tickets_trend',
    'bb_core.bb_figure.user_runs_trend',
    'bb_core.bb_figure.user_tokens_trend',
    'bb_core.bb_figure.team_user_tickets_trend',
    'bb_core.bb_figure.team_user_runs_trend',
    'bb_core.bb_figure.team_user_tokens_trend',
    'bb_core.bb_figure.team_tickets_trend',
    'bb_core.bb_figure.team_runs_trend',
    'bb_core.bb_figure.team_tokens_trend',
    'bb_core.bb_figure.project_tickets_trend',
    'bb_core.bb_figure.project_runs_trend',
    'bb_core.bb_figure.project_tokens_trend',
    'bb_core.bb_figure_group.overview',
    'bb_core.bb_figure_group.tickets',
    'bb_core.bb_figure_group.runs',
    'bb_core.bb_figure_group.breakdown',
    'bb_core.bb_measurement.run_tokens',
    'bb_core.bb_measurement.run_tokens_claimed',
    'bb_core.bb_measurement.run_tokens_running',
    'bb_core.bb_measurement.run_tokens_done',
    'bb_core.bb_measurement.run_tokens_expired',
    'bb_core.bb_measurement.run_tokens_failed',
    'bb_core.bb_figure.user_models',
    'bb_core.bb_figure.team_models',
    'bb_core.bb_figure.project_models',
    'bb_core.bb_figure.user_models_trend',
    'bb_core.bb_figure.team_models_trend',
    'bb_core.bb_figure.project_models_trend',
    'bb_core.bb_figure.team_members_tickets_trend',
    'bb_core.bb_figure_group.tokens',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installConfig(['user']);
  }

  /**
   * Recipe, sync, and update-path definitions are complete and identical.
   */
  public function testRecipeAndSyncShipTheSameCompleteCompositeModel(): void {
    $root = dirname($this->root, 1);
    $defaults = CompositeStatisticsDefaults::configurations();
    // Every decimal-valued measurement (a ratio, not a count) that any bar
    // figure could list by name. A `grouped_horizontal_bars` figure shares
    // one scale across every measurement it plots, so a ratio sharing an
    // axis with a count is meaningless there.
    $ratioMeasurements = [];
    foreach ($defaults as $configName => $data) {
      if (str_starts_with($configName, 'bb_core.bb_measurement.') && ($data['value_type'] ?? NULL) === 'decimal') {
        $ratioMeasurements[] = $data['id'];
      }
    }
    foreach (self::CONFIG_NAMES as $name) {
      $recipe = $root . '/recipes/bakers/config/' . $name . '.yml';
      $sync = $root . '/config/sync/' . $name . '.yml';
      self::assertFileExists($recipe);
      self::assertFileExists($sync);
      $recipeData = Yaml::parseFile($recipe);
      $syncData = Yaml::parseFile($sync);
      unset($syncData['uuid'], $syncData['_core']);
      self::assertSame($recipeData, $syncData, $name . ' is identical on both install paths.');
      self::assertSame($recipeData, $defaults[$name], $name . ' matches the update-path definition.');
      $schema = $this->checkConfigSchema($this->container->get('config.typed'), $name, $recipeData);
      self::assertTrue($schema === TRUE, sprintf('%s schema errors: %s', $name, print_r($schema, TRUE)));
      // No figure description may state an attribution basis the metric
      // does not use. `runs`/`run_tokens` bind the user scope to the
      // ticket's assignee, never to "the run's owning user" — a phrase that
      // reads as a different rule.
      if (str_starts_with($name, 'bb_core.bb_figure.')) {
        self::assertStringNotContainsString(
          'owning user',
          $recipeData['description'] ?? '',
          $name . ' must not state a "runs/tokens by the run\'s owning user" attribution basis.',
        );
        // A `team`-scoped figure is bound to the team through the ticket's
        // project (bindings.team resolves via `team_projects`), never
        // through team membership or the assignee, so a description may not
        // claim "team members" as the attribution rule.
        if (($recipeData['context_shape'] ?? []) === ['team']) {
          self::assertStringNotContainsString(
            'team members',
            $recipeData['description'] ?? '',
            $name . ' is team-scoped through the ticket\'s project, not through team membership.',
          );
        }
        // A figure that plots exactly one measurement may not name another
        // measurement's noun in its description — that clause belongs to a
        // figure that actually carries the metric.
        $measurements = $recipeData['measurements'] ?? [];
        if (count($measurements) === 1) {
          $noun = ['closed_tickets' => 'tickets', 'runs' => 'runs', 'run_tokens' => 'tokens'];
          $other = array_diff($noun, [$noun[$measurements[0]] ?? '']);
          foreach ($other as $word) {
            self::assertStringNotContainsString(
              $word . ' by',
              $recipeData['description'] ?? '',
              $name . ' plots only ' . $measurements[0] . ' and must not describe attribution for ' . $word . '.',
            );
          }
        }
      }
      if (($recipeData['widget'] ?? NULL) === 'grouped_horizontal_bars') {
        self::assertSame(
          [],
          array_intersect($recipeData['measurements'] ?? [], $ratioMeasurements),
          $name . ' is a grouped_horizontal_bars figure and must not list a ratio measurement.',
        );
      }
    }

    $teamUser = Yaml::parseFile($root . '/recipes/bakers/config/bb_core.bb_figure.team_user_overview.yml');
    self::assertSame(['team', 'user'], $teamUser['context_shape']);
    self::assertSame(['team', 'user'], array_keys($teamUser['conditions']));
    self::assertSame(['closed_tickets', 'runs', 'runs_per_ticket', 'run_tokens'], $teamUser['measurements']);

    $tickets = Yaml::parseFile($root . '/recipes/bakers/config/bb_core.bb_figure.user_tickets_trend.yml');
    self::assertSame(['7', '30', '365'], array_column($tickets['filters']['period']['options'], 'value'));
    self::assertSame('grouped_horizontal_bars', $tickets['widget']);
    self::assertSame(['closed_tickets'], $tickets['measurements']);
  }

}
