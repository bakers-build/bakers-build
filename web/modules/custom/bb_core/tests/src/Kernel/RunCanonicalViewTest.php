<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Datetime\Entity\DateFormat;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbRunBreadcrumbSource;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbRunRowSource;
use Drupal\bb_core\Routing\BbRunRouteProvider;
use Drupal\bb_core\Run\BbRunInspectorRows;
use Drupal\bb_core\RunLog\RunLogStore;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\views\Entity\View;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * Canonical run page: nested route, body empty-states, inspector rails.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunCanonicalViewTest extends KernelTestBase {

  use ShippedDisplayTrait;

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine', 'views',
    'field', 'og', 'link', 'text', 'filter', 'file', 'image',
    'markdown_easy', 'bb_core', 'island',
    'display_builder', 'display_builder_entity_view',
    'ui_patterns', 'ui_patterns_field', 'ui_patterns_field_formatters',
  ];

  /**
   * The workspace the fixture ticket belongs to.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The ticket the fixture run belongs to.
   */
  private BbTicketInterface $ticket;

  /**
   * The run under test.
   */
  private BbRunInterface $run;

  /**
   * {@inheritdoc}
   *
   * Core's own service provider only registers the `private` stream wrapper
   * when `file_private_path` is already set at container-build time.
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
      'user', 'og_membership', 'bb_group', 'bb_workspace', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_comment', 'bb_run',
      'bb_conductor', 'bb_term', 'file',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installConfig(['system', 'user', 'display_builder']);
    $this->config('system.date')
      ->set('timezone.default', 'UTC')
      ->set('timezone.user.configurable', FALSE)
      ->save();
    DateFormat::create([
      'id' => 'normal',
      'label' => 'Normal',
      'pattern' => 'j M Y, H:i',
      'status' => TRUE,
    ])->save();
    $this->installRunCanonicalDisplays();
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);

    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create([
      'name' => 'bakers.build',
      'slug' => 'bakers',
    ]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
    $group = $etm->getStorage('bb_group')->create([
      'name' => 'bakers.build group',
      'workspace_id' => $workspace->id(),
    ]);
    $group->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'bakers.build',
      'key' => 'BB',
      'group_id' => $group->id(),
    ]);
    $project->save();
    $ticket = $etm->getStorage('bb_ticket')->create([
      'title' => 'Canonical run page',
      'project_id' => $project->id(),
      'number' => 656,
      'identifier' => 'BB-656',
    ]);
    $ticket->save();
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $this->ticket = $ticket;

    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'done',
      'state_at_start' => 'coding',
    ]);
    $run->save();
    self::assertInstanceOf(BbRunInterface::class, $run);
    $this->run = $run;
  }

  /**
   * Canonical pins the full view; overlay is a separate product route.
   */
  public function testRoutesPinViewModesAndTitle(): void {
    $canonical = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_run.canonical');
    self::assertSame('bb_run.full', $canonical->getDefault('_entity_view'));
    self::assertSame(
      BbRunRouteProvider::class . '::title',
      $canonical->getDefault('_title_callback'),
    );
    self::assertSame('TRUE', $canonical->getRequirement('_bb_run_parentage_match'));
    self::assertSame(
      '/_workspace/{bb_workspace}/ticket/{bb_ticket}/run/{bb_run}',
      $canonical->getPath(),
    );

    $overlay = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_run.overlay');
    self::assertSame('bb_run.overlay', $overlay->getDefault('_entity_view'));
    self::assertSame(
      '/_workspace/{bb_workspace}/ticket/{bb_ticket}/run/{bb_run}/overlay',
      $overlay->getPath(),
    );
    self::assertSame('Run #' . $this->run->id(), BbRunRouteProvider::title($this->run));
  }

  /**
   * A run with no summary shows its empty-state.
   */
  public function testEmptyBodyShowsHonestEmptyStates(): void {
    $html = $this->renderMode('full');
    self::assertStringContainsString('Latest ticket summary', $html);
    self::assertStringContainsString('No ticket summary', $html);
    self::assertStringNotContainsString('data-component-id="bb_theme:log-viewer"', $html);
  }

  /**
   * The newest summary comment reaches the body.
   */
  public function testBodyRendersTheNewestSummary(): void {
    $etm = $this->container->get('entity_type.manager');
    $author = $etm->getStorage('user')->create(['name' => 'summary-author']);
    $author->save();
    $etm->getStorage('bb_comment')->create([
      'ticket_id' => $this->ticket->id(),
      'author' => $author->id(),
      'body' => ['value' => 'Latest summary body', 'format' => 'bb_rich'],
      'type' => 'summary',
    ])->save();
    $etm->getStorage('bb_ticket')->resetCache([$this->ticket->id()]);
    $etm->getStorage('bb_run')->resetCache([$this->run->id()]);
    $reloaded = $etm->getStorage('bb_run')->load($this->run->id());
    self::assertInstanceOf(BbRunInterface::class, $reloaded);
    $this->run = $reloaded;

    $html = $this->renderMode('full');
    self::assertStringNotContainsString('No ticket summary', $html);
    self::assertStringContainsString('Latest summary body', $html);
    self::assertStringContainsString('Open summary comment', $html);
    self::assertStringNotContainsString('Previous:', $html);
    self::assertStringNotContainsString('Next:', $html);
  }

  /**
   * Footprint is omitted when every metric is zero.
   *
   * Stored zeros stay visible once any metric is non-zero.
   */
  public function testFootprintOmitsAllZeroAndKeepsStoredZeros(): void {
    $rows = $this->inspector();
    self::assertArrayNotHasKey('footprint', $rows->blocks($this->run));

    $this->run->set('tokens', 12);
    $this->run->set('duration_s', 0);
    $build = $rows->footprint($this->run);
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);
    self::assertStringContainsString('Tokens', $html);
    self::assertStringContainsString('12', $html);
    self::assertStringContainsString('Duration', $html);
    self::assertStringContainsString('0s', $html);
  }

  /**
   * The active time sits beside the duration, both in seconds.
   */
  public function testFootprintShowsActiveTimeInSeconds(): void {
    $this->run->set('duration_s', 3620);
    $this->run->set('active_s', 20);
    $build = $this->inspector()->footprint($this->run);
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);
    self::assertStringContainsString('3620s', $html);
    self::assertStringContainsString('Active', $html);
    self::assertStringContainsString('20s', $html);
  }

  /**
   * Inspector timestamps use the product `normal` format, not ISO-8601.
   */
  public function testTimingUsesTheNormalDateFormat(): void {
    $this->run->set('started_at', 1782834600);
    $this->run->set('heartbeat', 1782837900);
    $build = $this->inspector()->timing($this->run);
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);
    self::assertStringContainsString('30 Jun 2026, 15:50', $html);
    self::assertStringContainsString('30 Jun 2026, 16:45', $html);
    self::assertStringNotContainsString('2026-06-30T', $html);
  }

  /**
   * Attribution names ticket, conductor, agent, harness and model.
   *
   * Empty provenance rows are omitted rather than shown as blank.
   */
  public function testAttributionShowsHarnessAndModelAndOmitsEmpty(): void {
    $this->run->set('agent', 'claude');
    $this->run->set('harness', 'claude-code');
    $this->run->set('model', 'opus');
    $this->run->set('model_version', 'claude-opus-4-5-20251101');
    $html = $this->renderBuild($this->inspector()->attribution($this->run));
    self::assertStringContainsString('Ticket', $html);
    self::assertStringContainsString('BB-656', $html);
    self::assertStringContainsString('Agent', $html);
    self::assertStringContainsString('claude', $html);
    self::assertStringContainsString('Harness', $html);
    self::assertStringContainsString('claude-code', $html);
    self::assertStringContainsString('Model', $html);
    self::assertStringContainsString('opus', $html);
    self::assertStringContainsString('Model version', $html);
    self::assertStringContainsString('claude-opus-4-5-20251101', $html);

    $this->run->set('agent', '');
    $this->run->set('harness', '');
    $this->run->set('model', '');
    $this->run->set('model_version', '');
    $omitted = $this->renderBuild($this->inspector()->attribution($this->run));
    self::assertStringNotContainsString('Harness', $omitted);
    self::assertStringNotContainsString('Model version', $omitted);
    self::assertStringNotContainsString('Agent', $omitted);
  }

  /**
   * Canonical breadcrumb is Workspace → Ticket → Run, empty off that route.
   */
  public function testBreadcrumbTrailOnCanonicalAndEmptyOffIt(): void {
    $this->installMyWorkRoute();
    $off = $this->breadcrumbSource()->getPropValue();
    self::assertIsArray($off);
    self::assertSame([], $off['#props']['items'] ?? []);
    self::assertContains('url.path', $off['#cache']['contexts'] ?? []);

    $this->enterCanonical();
    $on = $this->breadcrumbSource()->getPropValue();
    $html = (string) $this->container->get('renderer')->renderInIsolation($on);
    self::assertStringContainsString('data-component-id="bb_theme:breadcrumb"', $html);
    self::assertStringContainsString('bakers.build', $html);
    self::assertStringContainsString('BB-656', $html);
    self::assertStringContainsString('Run #' . $this->run->id(), $html);
    self::assertMatchesRegularExpression('/aria-current="page"[^>]*>Run #/', $html);
    self::assertStringContainsString($this->ticket->toUrl()->toString(), $html);
    self::assertStringContainsString('/bakers/tickets', $html);
  }

  /**
   * The ticket's run-history row links to this run's canonical page.
   */
  public function testRunHistoryRowLinksToTheCanonicalPage(): void {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('unknown')['schema'] ?? ['type' => 'array'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance(
        'bb_run_row',
        SourcePluginBase::buildConfiguration('items', $definition, ['source' => []], []),
      );
    self::assertInstanceOf(BbRunRowSource::class, $source);
    $source->setContextValue('entity', $this->run);
    $items = $source->getPropValue();
    self::assertIsArray($items);
    $url = $this->run->toUrl()->toString();
    self::assertSame($url, $items[0]['cells']['state']['url'] ?? NULL);
    self::assertSame($url, $items[0]['url'] ?? NULL);
  }

  /**
   * Overview is the only product tab on the nested canonical.
   */
  public function testOverviewIsTheOnlyCanonicalTab(): void {
    $tasks = $this->container->get('plugin.manager.menu.local_task')->getDefinitions();
    self::assertSame('Overview', (string) $tasks['entity.bb_run.canonical']['title']);
    self::assertSame('entity.bb_run.canonical', $tasks['entity.bb_run.canonical']['base_route']);
    self::assertArrayNotHasKey('entity.bb_run.edit_form', $tasks);
    self::assertArrayNotHasKey('entity.bb_run.delete_form', $tasks);
  }

  /**
   * Cancel run is offered only while the reader may cancel, and rechecked.
   */
  public function testCancelRunIsVisibleOnlyWhileEligible(): void {
    $this->run->set('state', 'running')->save();
    $html = $this->renderBuild($this->inspector()->status($this->run));
    self::assertStringContainsString('Cancel run', $html);

    $this->run->set('state', 'done')->save();
    $done = $this->renderBuild($this->inspector()->status($this->run));
    self::assertStringNotContainsString('Cancel run', $done);
  }

  /**
   * A stored log larger than 32 MiB is not read or embedded.
   *
   * BbRun::preSave() writes the payload and then sets log_bytes to its
   * length, so the size marker must be applied on a later save that does
   * not touch `log`.
   */
  public function testCanonicalDoesNotReadOrEmbedTheLargeLog(): void {
    $this->run->set('log', 'seed-log-payload');
    $this->run->save();
    $this->forbidRunLogReads();
    $this->run->set('log_bytes', 40 * 1024 * 1024);
    $this->run->save();
    self::assertGreaterThan(32 * 1024 * 1024, (int) $this->run->get('log_bytes')->value);

    $html = $this->renderMode('full');
    self::assertStringNotContainsString('seed-log-payload', $html);
    self::assertStringNotContainsString('data-component-id="bb_theme:log-viewer"', $html);
    $downloads = $this->renderBuild($this->inspector()->downloads($this->run));
    self::assertStringContainsString('Run log', $downloads);
  }

  /**
   * Overlay may include the error log; canonical body never does.
   */
  public function testOverlayCanCarryTheErrorLog(): void {
    $this->run->set('error_log', 'dispatch exploded');
    $this->run->save();
    $overlay = $this->renderMode('overlay');
    self::assertStringContainsString('data-component-id="bb_theme:log-viewer"', $overlay);
    self::assertStringContainsString('dispatch exploded', $overlay);
    self::assertStringNotContainsString(
      'data-component-id="bb_theme:log-viewer"',
      $this->renderMode('full'),
    );
  }

  /**
   * Replaces the log store so any read during render fails the test.
   */
  private function forbidRunLogReads(): void {
    $this->container->set(RunLogStore::class, new class {

      /**
       * Fails the test when a stored log is read.
       */
      public function read(mixed $file, mixed $run): string {
        throw new \RuntimeException('canonical page must not read the run log.');
      }

    });
  }

  /**
   * Renders a build array in isolation.
   *
   * @param array<string, mixed> $build
   *   The render array.
   */
  private function renderBuild(array $build): string {
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Renders the run in a shipped view mode.
   */
  private function renderMode(string $mode): string {
    $build = $this->container->get('entity_type.manager')
      ->getViewBuilder('bb_run')
      ->view($this->run, $mode);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * The inspector-row builder.
   */
  private function inspector(): BbRunInspectorRows {
    return $this->container->get('bb_core.run_inspector_rows');
  }

  /**
   * Stages the nested canonical as the current request.
   */
  private function enterCanonical(): void {
    $route_name = 'entity.bb_run.canonical';
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $path = str_replace(
      ['{bb_workspace}', '{bb_ticket}', '{bb_run}'],
      [$this->workspace->getSlug(), mb_strtolower($this->ticket->getIdentifier()), (string) $this->run->id()],
      $route->getPath(),
    );
    $request = Request::create($path);
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('bb_workspace', $this->workspace);
    $request->attributes->set('bb_ticket', $this->ticket);
    $request->attributes->set('bb_run', $this->run);
    $this->container->get('request_stack')->push($request);
  }

  /**
   * Registers `view.tickets.my_work` so the workspace crumb can be generated.
   */
  private function installMyWorkRoute(): void {
    View::create([
      'id' => 'tickets',
      'label' => 'Ticket navigation routes',
      'base_table' => 'users_field_data',
      'base_field' => 'uid',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_title' => 'Default',
          'display_plugin' => 'default',
          'position' => 0,
          'display_options' => [
            'access' => ['type' => 'none'],
          ],
        ],
        'my_work' => [
          'id' => 'my_work',
          'display_title' => 'My work',
          'display_plugin' => 'page',
          'position' => 1,
          'display_options' => [
            'path' => '_workspace/%bb_workspace/tickets',
          ],
        ],
      ],
    ])->save();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Instantiates the shared-header breadcrumb source.
   */
  private function breadcrumbSource(): BbRunBreadcrumbSource {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance(
        'bb_run_breadcrumb',
        SourcePluginBase::buildConfiguration('breadcrumb', $definition, ['source' => []], []),
      );
    self::assertInstanceOf(BbRunBreadcrumbSource::class, $source);
    return $source;
  }

  /**
   * Installs the view modes and displays the canonical page composes.
   */
  private function installRunCanonicalDisplays(): void {
    $module = $this->container->get('extension.list.module')->getPath('bb_core');
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    $this->writeShippedConfig($target, $module . '/config/install', 'filter.format.bb_rich');
    foreach ([
      'core.entity_view_mode.bb_run.full' => $module . '/config/optional',
      'core.entity_view_mode.bb_run.overlay' => $module . '/config/optional',
      'core.entity_view_display.bb_run.bb_run.full' => $recipe,
      'core.entity_view_display.bb_run.bb_run.overlay' => $recipe,
      'core.entity_view_mode.bb_comment.full' => $module . '/config/optional',
      'core.entity_view_display.bb_comment.bb_comment.full' => $recipe,
      'core.entity_view_mode.bb_comment.teaser' => $module . '/config/optional',
      'core.entity_view_display.bb_comment.bb_comment.teaser' => $recipe,
    ] as $name => $directory) {
      $this->writeShippedConfig($target, $directory, $name);
    }
  }

  /**
   * Writes one shipped config file into active config.
   *
   * @param \Drupal\Core\Config\StorageInterface $target
   *   Active config storage.
   * @param string $directory
   *   Directory the shipped YAML lives in.
   * @param string $name
   *   Config name without `.yml`.
   */
  private function writeShippedConfig($target, string $directory, string $name): void {
    $file = $directory . '/' . $name . '.yml';
    self::assertFileExists($file, sprintf('%s ships.', $name));
    $data = Yaml::decode((string) file_get_contents($file));
    $data = $this->withoutUnknownSources($data);
    $data['uuid'] = $this->container->get('uuid')->generate();
    $target->write($name, $data);
  }

}
