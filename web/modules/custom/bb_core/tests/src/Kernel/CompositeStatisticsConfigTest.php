<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\Schema\SchemaCheckTrait;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Yaml\Yaml;

/**
 * Recipe and sync ship the same complete composite statistics config.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CompositeStatisticsConfigTest extends KernelTestBase {

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
    'bb_core.bb_figure.team_user_tickets_trend',
    'bb_core.bb_figure.team_user_runs_trend',
    'bb_core.bb_figure.team_user_tokens_trend',
    'bb_core.bb_figure.team_tickets_trend',
    'bb_core.bb_figure.team_runs_trend',
    'bb_core.bb_figure.team_tokens_trend',
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
    'bb_core.bb_figure.team_models',
    'bb_core.bb_figure.team_models_trend',
    'bb_core.bb_figure.team_members_tickets_trend',
    'bb_core.bb_figure_group.tokens',
    'bb_core.bb_measurement.created_tickets',
    'bb_core.bb_measurement.open_tickets',
    'bb_core.bb_measurement.job_rating',
    'bb_core.bb_measurement.rated_tickets',
    'bb_core.bb_measurement.closed_tickets_many_runs',
    'bb_core.bb_measurement.tokens_per_ticket',
    'bb_core.bb_figure.workspace_overview',
    'bb_core.bb_figure.workspace_flow',
    'bb_core.bb_figure.workspace_models',
    'bb_core.bb_figure.workspace_projects_tokens',
    'bb_core.bb_figure.workspace_projects',
    'bb_core.bb_figure.workspace_people',
    'bb_core.bb_figure.project_flow',
    'bb_core.bb_figure.project_people',
    'bb_core.bb_figure_group.insights',
    'bb_core.bb_figure.user_flow',
    'bb_core.bb_figure.user_tickets',
    'bb_core.bb_figure_group.my_work',
  ];

  /**
   * The Project › Stats figures: one per Insights building block.
   */
  private const PROJECT_STATS = [
    'project_overview' => 'tiles',
    'project_flow' => 'flow',
    'project_people' => 'table',
  ];

  /**
   * The project figures Project › Stats replaced.
   */
  private const REPLACED = [
    'project_models', 'project_models_trend', 'project_tickets_trend',
    'project_runs_trend', 'project_tokens_trend',
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
   * Recipe and sync definitions are complete and identical.
   */
  public function testRecipeAndSyncShipTheSameCompleteCompositeModel(): void {
    $root = dirname($this->root, 1);
    // Every decimal-valued measurement (a ratio, not a count) that any bar
    // figure could list by name. A `grouped_horizontal_bars` figure shares
    // one scale across every measurement it plots, so a ratio sharing an
    // axis with a count is meaningless there.
    $ratioMeasurements = [];
    foreach (glob($root . '/recipes/bakers/config/bb_core.bb_measurement.*.yml') ?: [] as $file) {
      $data = Yaml::parseFile($file);
      if (($data['value_type'] ?? NULL) === 'decimal') {
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
      if (isset($recipeData['filters']['period'])) {
        // Insights, Project › Stats and My work open on this month; every
        // other stats page on this week.
        $id = substr($name, strlen('bb_core.bb_figure.'));
        $month = str_starts_with($id, 'workspace_') || isset(self::PROJECT_STATS[$id]) || str_starts_with($id, 'user_');
        $default = $month ? 'month' : 'week';
        self::assertSame($default, $recipeData['filters']['period']['default'], $name . ' defaults to the current ' . $default . '.');
        self::assertSame(
          [
            ['value' => 'week', 'label' => 'Week'],
            ['value' => 'month', 'label' => 'Month'],
            ['value' => 'quarter', 'label' => 'Quarter'],
            ['value' => 'year', 'label' => 'Year'],
            ['value' => 'all', 'label' => 'All time'],
            ['value' => 'custom', 'label' => 'Custom'],
          ],
          $recipeData['filters']['period']['options'],
          $name . ' offers the calendar period kinds.',
        );
      }
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

    foreach (self::PROJECT_STATS as $id => $widget) {
      $figure = Yaml::parseFile($root . '/recipes/bakers/config/bb_core.bb_figure.' . $id . '.yml');
      self::assertSame($widget, $figure['widget'], "$id draws a $widget.");
      self::assertSame(['project'], $figure['context_shape']);
      self::assertSame(['period', 'epic', 'user'], array_keys($figure['filters']), "$id filters by period, epic and person.");
      self::assertSame(['label' => 'Epic', 'type' => 'entities', 'binding' => 'epic'], $figure['filters']['epic']);
      self::assertStringNotContainsString('hours', $figure['description']);
    }
    $groups = [];
    foreach (glob($root . '/recipes/bakers/config/bb_core.bb_figure_group.*.yml') ?: [] as $file) {
      $groups[basename($file)] = Yaml::parseFile($file)['figures'];
    }
    self::assertSame(['bb_core.bb_figure_group.insights.yml'], array_keys(array_filter($groups, static fn(array $figures): bool => array_intersect($figures, array_keys(self::PROJECT_STATS)) !== [])), 'Only Insights lists the Project › Stats figures.');
    foreach (self::REPLACED as $id) {
      foreach (['/recipes/bakers/config/', '/config/sync/'] as $home) {
        self::assertFileDoesNotExist($root . $home . 'bb_core.bb_figure.' . $id . '.yml');
      }
      self::assertNotContains($id, array_merge(...array_values($groups)), "No group lists $id.");
    }

    // Every project viewer sees Project › Stats; no role keeps a replaced one.
    foreach (['/config/sync/', '/web/modules/custom/bb_core/config/install/'] as $home) {
      foreach (glob($root . $home . 'og.og_role.*.yml') ?: [] as $file) {
        $permissions = Yaml::parseFile($file)['permissions'] ?? [];
        foreach (self::REPLACED as $id) {
          self::assertNotContains("view bakers figure $id", $permissions, "$file drops $id.");
        }
      }
      foreach (['guest', 'contributor', 'lead'] as $rank) {
        $permissions = Yaml::parseFile($root . $home . "og.og_role.bb_workspace-bb_workspace-$rank.yml")['permissions'];
        foreach (array_keys(self::PROJECT_STATS) as $id) {
          self::assertContains("view bakers figure $id", $permissions, "A workspace $rank sees $id ($home).");
        }
      }
    }

    $flow = Yaml::parseFile($root . '/recipes/bakers/config/bb_core.bb_figure.user_flow.yml');
    self::assertSame(['user'], $flow['context_shape']);
    self::assertSame('flow', $flow['widget']);
    self::assertSame(['created_tickets', 'closed_tickets', 'open_tickets'], $flow['measurements']);
  }

}
