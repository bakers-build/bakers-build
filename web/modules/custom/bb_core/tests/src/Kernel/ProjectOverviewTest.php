<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTerm;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Database\Database;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Url;
use Drupal\bb_core\Controller\BbProjectTabController;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\ProjectOverviewSource;
use Drupal\bb_core\Project\ProjectInspectorRows;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use Drupal\views\Entity\View;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Project canonical Overview: `_entity_view` of `bb_project.full`.
 *
 * Main column: metrics, Needs attention, Epics and Activities, or one page
 * empty state without tickets. Inspector: About and Properties.
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
    'search_api', 'search_api_db',
    'bb_core', 'bb_activity', 'views',
    'display_builder', 'display_builder_entity_view',
    'ui_patterns', 'ui_patterns_field', 'ui_patterns_field_formatters',
    'bb_property_access_test',
  ];

  /**
   * The project the Overview renders.
   */
  private BbProjectInterface $project;

  /**
   * Deployments list targets, created dates and a scoped ticket drill-down.
   */
  public function testDeploymentsSection(): void {
    BbVocabulary::create(['id' => 'type', 'label' => 'Type'])->save();
    $type = BbTerm::create(['vid' => 'type', 'name' => 'deployment']);
    $type->save();
    $ticket = $this->workTicket('Carried work');
    $environments = $this->container->get('entity_type.manager')->getStorage('bb_environment')->loadByProperties(['name' => 'production']);
    $environment = reset($environments);
    self::assertInstanceOf(ContentEntityInterface::class, $environment);
    $older = $this->workTicket('Older release', [
      'ticket_type' => $type->id(),
      'created' => 100,
      'environments' => [$environment->id()],
      'referenced_tickets' => [$ticket->id()],
    ]);
    $newer = $this->workTicket('Newer release', ['ticket_type' => $type->id(), 'created' => 200]);
    $html = $this->renderMode('full');
    self::assertStringContainsString('Deployments', $html);
    self::assertStringContainsString('production', $html);
    self::assertStringContainsString('1 ticket', $html);
    self::assertStringContainsString('?deployment=' . $older->getIdentifier(), $html);
    self::assertStringContainsString('href="' . $newer->toUrl()->toString() . '"', $html);
    self::assertLessThan(strpos($html, 'Older release'), strpos($html, 'Newer release'));
    self::assertStringContainsString('<time', $html);
  }

  /**
   * The deployments section has its own empty state even without tickets.
   */
  public function testDeploymentsEmptyState(): void {
    self::assertStringContainsString('No deployments in this project.', $this->renderMode('full'));
  }

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
      'bb_run', 'bb_comment', 'file', 'bb_term',
      'bb_activity', 'bb_notification_setting', 'search_api_task',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installSchema('search_api', ['search_api_item']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installConfig(['system', 'user', 'display_builder', 'search_api']);
    $this->container->get('config.installer')->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->installOverviewDisplay();
    $this->installProjectBoardDisplay();
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
      'key' => 'BB',
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
   * The main column reads metrics, Needs attention, Epics, then Activities.
   */
  public function testMainColumnOrder(): void {
    $this->epicTicket('Ship the Overview tab');
    $this->labelled('Needs a reply', 'question');
    $this->indexTickets();

    $html = $this->renderMode('full');
    $positions = [];
    foreach (['Unhealthy', 'Needs attention', 'Epics', 'Activities'] as $heading) {
      $position = strpos($html, $heading);
      self::assertNotFalse($position, $heading . ' is on the Overview.');
      $positions[] = $position;
    }
    $sorted = $positions;
    sort($sorted);
    self::assertSame($sorted, $positions);
    self::assertStringNotContainsString('No tickets yet', $html);
  }

  /**
   * The tiles count the attention set and the Board's Intake and Working.
   */
  public function testMetricsCountAndUnhealthyLink(): void {
    $conductor = $this->conductor();
    $this->labelled('Asks one', 'question');
    $this->labelled('Asks two', 'question');
    $this->workTicket('Waiting', ['conductor_id' => $conductor]);
    for ($i = 0; $i < 3; $i++) {
      $this->workTicket('Busy ' . $i, ['conductor_id' => $conductor, 'state' => 'plan']);
    }
    $this->indexTickets();

    $metrics = $this->overviewSource('metrics')->getPropValue();
    self::assertIsArray($metrics);
    self::assertSame(0, $metrics['#cache']['max-age'] ?? NULL, 'Health is read per request.');
    $tiles = array_column($metrics['#slots']['content'] ?? [], '#props');
    self::assertSame(
      ['Unhealthy' => '2', 'Intake' => '1', 'In progress' => '3'],
      array_column($tiles, 'value', 'label'),
    );
    self::assertSame(['need a person now', 'conductor set, not started', 'being worked on'], array_column($tiles, 'detail'));

    $html = $this->renderMode('full');
    self::assertStringContainsString('href="' . $this->project->toUrl()->toString() . '/board?health=unhealthy"', $html);
  }

  /**
   * Needs attention shows the first five with their reason and a footer.
   */
  public function testNeedsAttentionShowsFiveWithFooter(): void {
    for ($i = 1; $i <= 7; $i++) {
      $this->labelled('Asks ' . $i, 'question');
    }

    $html = $this->renderMode('full');
    self::assertStringContainsString('Needs attention', $html);
    self::assertStringContainsString('Open tickets where a person has to act now', $html);
    self::assertStringContainsString('Open board', $html);
    self::assertSame(5, substr_count($html, 'Needs info'));
    self::assertStringContainsString('Showing 5 of 7 unhealthy tickets', $html);
    self::assertStringNotContainsString('Everything is flowing', $html);

    $attention = $this->overviewSource('attention')->getPropValue();
    self::assertIsArray($attention);
    self::assertSame(0, $attention['#cache']['max-age'] ?? NULL, 'Health is read per request.');
  }

  /**
   * A red reason draws the critical rail, a yellow one the attention rail.
   */
  public function testAttentionRowsShowTheirSeverity(): void {
    $this->labelled('Broken', 'technical problem');
    $this->labelled('Asks', 'question');

    $attention = $this->overviewSource('attention')->getPropValue();
    $items = $attention['#slots']['content'][0]['#props']['items'] ?? [];
    $accents = array_combine(
      array_map(static fn (array $row): string => $row['cells']['reason']['label'], $items),
      array_column($items, 'accent'),
    );

    self::assertSame(['Technical problem' => 'critical', 'Needs info' => 'attention'], $accents);
  }

  /**
   * A project where nobody has to act reads as flowing.
   */
  public function testEverythingIsFlowing(): void {
    $this->workTicket('Calm work');

    $html = $this->renderMode('full');
    self::assertStringContainsString('Needs attention', $html);
    self::assertStringContainsString('Everything is flowing', $html);
    self::assertStringContainsString('No open ticket needs a person right now.', $html);
    self::assertStringContainsString('nothing blocks the flow', $html);
    self::assertStringNotContainsString('unhealthy tickets', $html);
  }

  /**
   * An epic shows the progress of its direct children by work state.
   */
  public function testEpicProgress(): void {
    $conductor = $this->conductor();
    $epic = $this->epicTicket('Ship the Overview tab');
    $this->workTicket('Done one', ['parent_id' => $epic->id(), 'closed' => TRUE]);
    $this->workTicket('Done two', ['parent_id' => $epic->id(), 'closed' => TRUE]);
    $this->workTicket('Working child', ['parent_id' => $epic->id(), 'conductor_id' => $conductor, 'state' => 'plan']);
    $this->workTicket('Intake child', ['parent_id' => $epic->id(), 'conductor_id' => $conductor]);
    $this->workTicket('Still open');
    $this->indexTickets();

    $html = $this->renderMode('full');
    self::assertStringContainsString('Epics', $html);
    self::assertStringContainsString('Ship the Overview tab', $html);
    self::assertStringContainsString('href="' . $epic->toUrl()->toString() . '"', $html);
    self::assertStringContainsString('2 of 4 done - 1 in progress - 1 open', $html);
    self::assertStringContainsString('50 %', $html);
    self::assertStringNotContainsString('Still open', $html);
    self::assertStringNotContainsString('No epics in this project.', $html);
  }

  /**
   * Without a visible ticket the page shows one empty state, no sections.
   */
  public function testEmptyProjectShowsOnePageEmptyState(): void {
    $html = $this->renderMode('full');

    self::assertStringContainsString('No tickets yet', $html);
    self::assertStringContainsString('Once tickets arrive, this page shows what needs attention, how epics progress and what happened.', $html);
    foreach (['Unhealthy', 'Needs attention', 'Epics', 'Activities'] as $section) {
      self::assertStringNotContainsString($section, $html);
    }
    self::assertStringContainsString('About', $html);
    self::assertStringContainsString('Properties', $html);
  }

  /**
   * Edit reaches Settings for `update` access only.
   */
  public function testEditLinkOnlyWithUpdateAccess(): void {
    $this->installOgScopeFixture();
    $etm = $this->container->get('entity_type.manager');
    $workspace = $this->workspace();
    $team = $etm->getStorage('bb_team')->load($this->project->get('teams')->target_id);
    self::assertInstanceOf(ContentEntityInterface::class, $team);
    $settings = Url::fromRoute('bb_core.bb_project.settings', $this->project->toUrl()->getRouteParameters())->toString();

    foreach (['lead' => TRUE, 'contributor' => FALSE, 'guest' => FALSE] as $rank => $edits) {
      $account = $this->createUser([], 'overview-' . $rank);
      self::assertInstanceOf(UserInterface::class, $account);
      $this->addMembership($workspace, $account, [$rank]);
      $this->addMembership($team, $account);
      $this->setCurrentUser($account);
      self::assertTrue($this->project->access('view'), $rank . ' reads the project.');
      self::assertSame($edits, $this->project->access('update'));

      $html = $this->renderMode('full');
      self::assertStringContainsString('Properties', $html, $rank);
      $link = (bool) preg_match('#<a[^>]*href="' . preg_quote($settings, '#') . '"[^>]*>(?:(?!</a>).)*\bEdit\b(?:(?!</a>).)*</a>#s', $html);
      self::assertSame($edits, $link, $rank . ($edits ? ' sees Edit.' : ' sees no Edit.'));
    }
  }

  /**
   * Memberships decide the empty state; the update access decides Edit.
   */
  public function testCacheabilityFollowsMembershipsAndUpdateAccess(): void {
    $this->installOgScopeFixture();
    $empty = $this->overviewSource('empty')->alterComponent([]);
    self::assertContains('og_membership_list', $empty['#cache']['tags'] ?? []);

    $contributor = $this->createUser([], 'overview-cache');
    self::assertInstanceOf(UserInterface::class, $contributor);
    $this->addMembership($this->workspace(), $contributor, ['contributor']);
    $this->seatOnProjectTeam($this->project, $contributor);
    foreach ([$this->container->get('current_user')->getAccount(), $contributor] as $account) {
      $this->setCurrentUser($account);
      $access = CacheableMetadata::createFromObject($this->project->access('update', NULL, TRUE));
      $edit = $this->overviewSource('edit')->getPropValue();
      self::assertNotSame([], $access->getCacheContexts());
      self::assertSame([], array_diff($access->getCacheContexts(), $edit['#cache']['contexts'] ?? []), 'Edit varies as its access.');
      self::assertSame([], array_diff($access->getCacheTags(), $edit['#cache']['tags'] ?? []), 'Edit invalidates with its access.');
    }
  }

  /**
   * The inspector shows About and the properties, Origin as links.
   */
  public function testInspectorShowsAboutAndOrigin(): void {
    $this->workTicket('From GitLab', ['origin' => 'https://gitlab.example.com/keytec/bakers/-/issues/12']);

    $html = $this->renderMode('full');
    self::assertStringContainsString('About', $html);
    self::assertStringContainsString('The settings note on Overview.', $html);
    foreach (['Key', 'Origin', 'Repository', 'Teams', 'Group', 'Environments'] as $label) {
      self::assertStringContainsString('>' . $label . '<', $html);
    }
    self::assertMatchesRegularExpression('#<a[^>]*href="https://gitlab.example.com/keytec/bakers"[^>]*>GitLab - keytec/bakers</a>#', $html);
    self::assertStringContainsString('https://git.example/bakers.git', $html);
    self::assertStringContainsString('Platform Crew', $html);
    self::assertStringContainsString('production', $html);
    self::assertStringNotContainsString('Identity', $html);
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
    self::assertSame('BB', $rows['key']['cells']['value']['value']);
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
   * The display puts the sections in main, About and Properties aside.
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
    self::assertSame(['project_about', 'project_properties'], array_column($sources, 'node_id'));
    self::assertSame('overview_about', $sources[0]['source']['component']['slots']['content']['sources'][0]['node_id']);
    self::assertSame('overview_edit', $sources[1]['source']['component']['slots']['actions']['sources'][0]['node_id']);
    $main = $canvas['source']['component']['slots']['main']['sources'];
    self::assertSame(
      [
        'overview_metrics', 'overview_attention', 'overview_epics',
        'overview_deployments', 'project_activities', 'overview_empty',
      ],
      array_column($main, 'node_id'),
    );
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
   * A project with tickets but no epic says so in the Epics section.
   */
  public function testEpicsViewModeShowsEmptyCopy(): void {
    $this->featureTicket('No epic here');
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
   * A saved work ticket on the fixture project.
   *
   * @param string $title
   *   Ticket title.
   * @param array<string, mixed> $values
   *   Extra field values.
   */
  private function workTicket(string $title, array $values = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create($values + [
        'title' => $title,
        'workflow' => 'bb_work',
        'project_id' => $this->project->id(),
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * A work ticket carrying one label of the project's workspace.
   */
  private function labelled(string $title, string $label): BbTicketInterface {
    if (!BbVocabulary::load('label')) {
      BbVocabulary::create(['id' => 'label', 'label' => 'label'])->save();
    }
    $values = ['vid' => 'label', 'name' => $label, 'workspace_id' => $this->workspace()->id()];
    $matches = $this->container->get('entity_type.manager')->getStorage('bb_term')->loadByProperties($values);
    $term = reset($matches);
    if (!$term instanceof BbTerm) {
      $term = BbTerm::create($values);
      $term->save();
    }
    return $this->workTicket($title, ['labels' => [$term->id()]]);
  }

  /**
   * The fixture workspace.
   */
  private function workspace(): ContentEntityInterface {
    $workspaces = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->loadByProperties(['slug' => 'acme']);
    $workspace = reset($workspaces);
    self::assertInstanceOf(ContentEntityInterface::class, $workspace);
    return $workspace;
  }

  /**
   * The id of an online conductor of the fixture project.
   */
  private function conductor(): int|string|null {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => 'overview-conductor',
      'label' => 'overview-conductor',
      'owner_user_id' => 1,
      'status' => 'online',
      'project_id' => $this->project->id(),
      'states' => ['plan'],
    ]);
    $conductor->save();
    return $conductor->id();
  }

  /**
   * Indexes the tracked tickets, so the Board counts see them.
   */
  private function indexTickets(): void {
    $this->container->get('entity_type.manager')->getStorage('search_api_index')->load('bb_tickets')->indexItems();
  }

  /**
   * Registers the project Board page route the Unhealthy tile links to.
   */
  private function installProjectBoardDisplay(): void {
    View::create([
      'id' => 'project_board',
      'label' => 'project_board',
      'base_table' => 'bb_project',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_title' => 'Default',
          'display_plugin' => 'default',
          'position' => 0,
          'display_options' => ['access' => ['type' => 'none']],
        ],
        'project_board' => [
          'id' => 'project_board',
          'display_title' => 'Project board',
          'display_plugin' => 'page',
          'position' => 1,
          'display_options' => [
            'path' => '_workspace/%bb_workspace/project/%bb_project/board',
            'access' => ['type' => 'none'],
          ],
        ],
      ],
    ])->save();
  }

  /**
   * A feature ticket on the fixture project.
   */
  private function featureTicket(string $title): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'title' => $title,
        'workflow' => 'bb_work',
        'project_id' => $this->project->id(),
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * An epic ticket on the fixture project.
   */
  private function epicTicket(string $title, string $state = 'working'): BbTicketInterface {
    if (!BbVocabulary::load('type')) {
      BbVocabulary::create(['id' => 'type', 'label' => 'type'])->save();
    }
    $epic = BbTerm::create(['vid' => 'type', 'name' => 'epic']);
    $epic->save();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'title' => $title,
        'workflow' => 'bb_work',
        'ticket_type' => $epic->id(),
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
