<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Database\Database;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\bb_core\Controller\BbProjectTabController;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\ProjectOverviewSource;
use Drupal\bb_core\Project\ProjectInspectorRows;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\ui_patterns\SourcePluginBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Project canonical Overview: `_entity_view` of `bb_project.full`.
 *
 * Epics is the inspector list (`bb_project.epics` view mode), not a tab.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectOverviewTest extends KernelTestBase {

  use ShippedDisplayTrait;

  use OgScopeFixtureTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og', 'island',
    'bb_core', 'views',
    'display_builder', 'display_builder_entity_view',
    'ui_patterns', 'ui_patterns_field', 'ui_patterns_field_formatters',
    'bb_property_access_test',
  ];

  /**
   * The project the Overview renders.
   */
  private BbProjectInterface $project;

  /**
   * {@inheritdoc}
   *
   * A failed run's error log is a private file; core registers the private
   * stream wrapper only when the path is set at container-build time.
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->register('stream_wrapper.private', 'Drupal\Core\StreamWrapper\PrivateStream')
      ->addTag('stream_wrapper', ['scheme' => 'private']);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group',
      'bb_project', 'bb_environment', 'bb_conductor', 'bb_ticket',
      'bb_run', 'bb_comment', 'file',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installConfig(['system', 'user', 'display_builder']);
    $this->installOverviewDisplay();
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $this->container->get('router.builder')->rebuild();

    $storage = $this->container->get('entity_type.manager');
    $workspace = $storage->getStorage('bb_workspace')
      ->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    $group = $storage->getStorage('bb_group')
      ->create(['name' => 'Acme group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $storage->getStorage('bb_team')
      ->create(['name' => 'Platform Crew', 'workspace_id' => $workspace->id()]);
    $team->save();
    $project = $storage->getStorage('bb_project')->create([
      'name' => 'bakers.build Platform',
      'key' => 'bakers.build',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
      'description' => 'The settings note on Overview.',
      'repository' => ['url' => 'https://git.example/bakers.git', 'default_branch' => 'main'],
    ]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    $this->project = $project;

    $environment = $storage->getStorage('bb_environment')->create([
      'name' => 'production',
      'project_id' => $project->id(),
    ]);
    $environment->save();
    $reloaded = $storage->getStorage('bb_project')->load($project->id());
    self::assertInstanceOf(BbProjectInterface::class, $reloaded);
    $this->project = $reloaded;
  }

  /**
   * The canonical route renders the view mode itself — no controller.
   */
  public function testCanonicalRouteRendersTheFullViewModeWithoutController(): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_project.canonical');

    self::assertSame('bb_project.full', $route->getDefault('_entity_view'));
    self::assertNull($route->getDefault('_controller'));
    self::assertSame('bb_project.view', $route->getRequirement('_entity_access'));
  }

  /**
   * The title callback names the project, not the workspace ahead of it.
   */
  public function testCanonicalRouteKeepsAnExplicitProjectTitleCallback(): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_project.canonical');

    self::assertSame(
      BbProjectTabController::class . '::title',
      $route->getDefault('_title_callback'),
    );
    self::assertSame(
      'bakers.build Platform',
      BbProjectTabController::create($this->container)->title($this->project),
    );
  }

  /**
   * Empty Overview shows Properties and Epics, with no counts.
   */
  public function testFullViewModeRendersFlowingCopyAndProperties(): void {
    $html = $this->renderMode('full');

    self::assertStringNotContainsString('intake', $html);
    self::assertStringNotContainsString('in progress', $html);
    self::assertStringContainsString('Properties', $html);
    self::assertStringContainsString('Key', $html);
    self::assertStringContainsString('bakers.build', $html);
    self::assertStringContainsString('https://git.example/bakers.git', $html);
    self::assertStringContainsString('Environments', $html);
    self::assertStringContainsString('production', $html);
    self::assertStringContainsString('The settings note on Overview.', $html);
    self::assertStringContainsString('Epics', $html);
    self::assertStringContainsString('No epics in this project.', $html);
  }

  /**
   * Inspector rows are keyed by field and skip empty values.
   */
  public function testInspectorRowsAreKeyedByFieldAndSkipEmpty(): void {
    $inspector = $this->container->get(ProjectInspectorRows::class);
    $rows = $inspector->build($this->project);
    self::assertSame(['key', 'repository', 'environments'], array_keys($rows));
    self::assertSame('Key', $rows['key']['cells']['label']['value']);
    self::assertSame('mono', $rows['key']['cells']['value']['kind']);
    self::assertSame('bakers.build', $rows['key']['cells']['value']['value']);
    self::assertSame('badge', $rows['environments']['cells']['value']['kind']);
    self::assertSame('production', $rows['environments']['cells']['value']['label']);

    $empty = $this->container->get('entity_type.manager')->getStorage('bb_project')->create([
      'name' => 'Bare',
      'key' => 'BARE',
      'group_id' => $this->project->get('group_id')->target_id,
      'teams' => $this->project->get('teams')->getValue(),
    ]);
    $empty->save();
    self::assertInstanceOf(BbProjectInterface::class, $empty);
    $built = $inspector->build($empty);
    self::assertSame(['key'], array_keys($built));
    self::assertSame('BARE', $built['key']['cells']['value']['value']);
    self::assertSame([], $inspector->propertiesBlock([]));
  }

  /**
   * The display wraps Overview in a canvas so Properties sit in the inspector.
   */
  public function testFullViewModePlacesTheCardsInTheInspector(): void {
    $display = Yaml::decode((string) file_get_contents(
      dirname(DRUPAL_ROOT) . '/recipes/bakers/config/core.entity_view_display.bb_project.bb_project.full.yml',
    ));
    $canvas = $display['third_party_settings']['display_builder']['sources'][0];
    self::assertSame('bb_theme:canvas', $canvas['source']['component']['component_id']);
    $inspector = $canvas['source']['component']['slots']['inspector']['sources'][0];
    self::assertSame('bb_theme:inspector', $inspector['source']['component']['component_id']);
    self::assertTrue($inspector['source']['component']['props']['surface']['source']['value']);
    $inspector_ids = array_column($canvas['source']['component']['slots']['inspector']['sources'], 'node_id');
    // One sticky surface: sibling sticky surfaces would slide over each other.
    self::assertSame(['project_inspector'], $inspector_ids, 'One inspector surface holds every card.');
    $sources = $inspector['source']['component']['slots']['rows']['sources'];
    self::assertSame(['project_identity', 'project_properties', 'overview_epics'], array_column($sources, 'node_id'));
  }

  /**
   * The Epics view mode is the list the Overview inspector embeds.
   */
  public function testEpicsViewModeIsTheListOnly(): void {
    $display = Yaml::decode((string) file_get_contents(
      dirname(DRUPAL_ROOT) . '/recipes/bakers/config/core.entity_view_display.bb_project.bb_project.epics.yml',
    ));
    $source = $display['third_party_settings']['display_builder']['sources'][0];
    self::assertSame('bb_project_overview', $source['source_id']);
    self::assertSame('epics', $source['source']['section']);
    self::assertSame('overview_epics', $source['node_id']);
  }

  /**
   * The slot source returns the description and the Epics zone.
   */
  public function testOverviewSourceReturnsDescriptionAndEpics(): void {
    $all = $this->overviewSource()->getPropValue();
    self::assertIsArray($all);
    self::assertCount(2, $all);
    self::assertSame('bb_theme:text', $all[0]['#component'] ?? NULL);
    self::assertSame('start', $all[0]['#props']['align'] ?? NULL);
    self::assertSame('bb_theme:zone', $all[1]['#component'] ?? NULL);
    self::assertSame('Epics', (string) ($all[1]['#slots']['heading']['#plain_text'] ?? ''));
  }

  /**
   * A section source builds only that section.
   */
  public function testOverviewSourceBuildsOnlyTheRequestedSection(): void {
    $ticket = $this->featureTicket('Counted');
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();

    Database::startLog('overview-description');
    $description = $this->overviewSource('description')->getPropValue();
    $description_log = Database::getLog('overview-description');
    self::assertIsArray($description);
    self::assertSame('bb_theme:text', $description['#component'] ?? NULL);
    foreach ($description_log as $query) {
      self::assertStringNotContainsString('bb_ticket', (string) ($query['query'] ?? ''));
    }

    Database::startLog('overview-epics');
    $epics = $this->overviewSource('epics')->getPropValue();
    $epics_log = Database::getLog('overview-epics');
    self::assertIsArray($epics);
    $ticket_queries = array_filter(
      $epics_log,
      static fn(array $query): bool => str_contains((string) ($query['query'] ?? ''), 'bb_ticket'),
    );
    self::assertNotSame([], $ticket_queries);
  }

  /**
   * Overview inspector lists epic tickets and skips work tickets.
   */
  public function testFullViewModeShowsEpicTicketsInTheInspector(): void {
    $epic = $this->epicTicket('Ship the Overview tab', 'active');
    $this->featureTicket('Still open');

    $html = $this->renderMode('full');
    $href = $epic->toUrl()->toString();
    self::assertStringContainsString('Epics', $html);
    self::assertStringContainsString('Ship the Overview tab', $html);
    self::assertStringContainsString('href="' . $href . '"', $html);
    self::assertStringContainsString('cursor-pointer', $html);
    self::assertStringContainsString('Properties', $html);
    self::assertStringNotContainsString('Still open', $html);
    self::assertStringNotContainsString('No epics in this project.', $html);
  }

  /**
   * An empty Epics inspector list still renders the list empty slot.
   */
  public function testEpicsViewModeShowsEmptyCopy(): void {
    $html = $this->renderMode('epics');
    self::assertStringContainsString('No epics in this project.', $html);
  }

  /**
   * Renders a shipped project view mode.
   */
  private function renderMode(string $mode): string {
    $this->container->get('theme_installer')->install(['bb_theme']);
    $build = $this->container->get('entity_type.manager')
      ->getViewBuilder('bb_project')
      ->view($this->project, $mode);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Instantiates the overview source against the fixture project.
   */
  private function overviewSource(string $section = ''): ProjectOverviewSource {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance(
        'bb_project_overview',
        SourcePluginBase::buildConfiguration('content', $definition, ['source' => ['section' => $section]], []),
      );
    self::assertInstanceOf(ProjectOverviewSource::class, $source);
    $source->setContextValue('entity', $this->project);
    return $source;
  }

  /**
   * A feature ticket on the fixture project.
   */
  private function featureTicket(string $title): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'title' => $title,
        'workflow' => 'bb_feature',
        'project_id' => $this->project->id(),
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * An epic ticket on the fixture project.
   */
  private function epicTicket(string $title, string $state = 'active'): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'title' => $title,
        'workflow' => 'bb_epic',
        'state' => $state,
        'project_id' => $this->project->id(),
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Writes the shipped config objects the Overview and Epics view modes need.
   */
  private function installOverviewDisplay(): void {
    $module = $this->container->get('extension.list.module')->getPath('bb_core');
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    // Rich text runs through check_markup('bb_rich').
    foreach ([
      'filter.format.bb_rich' => $module . '/config/install',
      'core.entity_view_mode.bb_project.full' => $module . '/config/optional',
      'core.entity_view_mode.bb_project.epics' => $module . '/config/optional',
      'core.entity_view_display.bb_project.bb_project.full' => $recipe,
      'core.entity_view_display.bb_project.bb_project.epics' => $recipe,
    ] as $name => $directory) {
      $file = $directory . '/' . $name . '.yml';
      self::assertFileExists($file, sprintf('%s ships on the recipe path.', $name));
      $data = Yaml::decode((string) file_get_contents($file));
      $data = $this->withoutUnknownSources($data);
      $data['uuid'] = $this->container->get('uuid')->generate();
      $target->write($name, $data);
    }
  }

}
