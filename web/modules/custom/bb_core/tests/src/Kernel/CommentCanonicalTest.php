<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Datetime\Entity\DateFormat;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbCommentBreadcrumbSource;
use Drupal\bb_core\Routing\BbCommentRouteProvider;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use Drupal\views\Entity\View;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * Canonical comment page: full view, title, Overview, breadcrumb, body.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CommentCanonicalTest extends KernelTestBase {

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
   * The ticket the fixture comment belongs to.
   */
  private BbTicketInterface $ticket;

  /**
   * The comment under test.
   */
  private BbCommentInterface $comment;

  /**
   * {@inheritdoc}
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
    $this->installCommentCanonicalDisplays();
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);

    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create([
      'name' => 'keytec',
      'slug' => 'keytec',
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
      'title' => 'Comment canonical',
      'project_id' => $project->id(),
      'number' => 142,
      'identifier' => 'BB-142',
      'workflow' => 'bb_feature',
      'state' => 'coding',
    ]);
    $ticket->save();
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $this->ticket = $ticket;

    $author = $this->createUser([], 'Ada Lovelace');
    self::assertInstanceOf(UserInterface::class, $author);
    $comment = $etm->getStorage('bb_comment')->create([
      'ticket_id' => $ticket->id(),
      'author' => $author->id(),
      'body' => [
        'value' => "| Col A | Col B |\n| --- | --- |\n| one | two |\n\nBB-657-END-MARKER",
        'format' => 'bb_rich',
      ],
      'type' => 'summary',
    ]);
    self::assertInstanceOf(BbCommentInterface::class, $comment);
    $comment->setCreatedTime(1782834600);
    $comment->save();
    $this->comment = $comment;
  }

  /**
   * Canonical pins the full view and a comment title, not the workspace.
   */
  public function testRoutePinsFullViewAndCommentTitle(): void {
    $canonical = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_comment.canonical');
    self::assertSame('bb_comment.full', $canonical->getDefault('_entity_view'));
    self::assertSame('bb_comment.view', $canonical->getRequirement('_entity_access'));
    self::assertSame(
      BbCommentRouteProvider::class . '::title',
      $canonical->getDefault('_title_callback'),
    );
    self::assertFalse($canonical->getOption('_admin_route'));
    self::assertSame(
      '/_workspace/{bb_workspace}/comment/{bb_comment}',
      $canonical->getPath(),
    );
    self::assertSame('Open summary comment', BbCommentRouteProvider::title($this->comment));
    $url = $this->comment->toUrl()->toString();
    self::assertStringContainsString('/keytec/comment/', $url);
    self::assertStringContainsString($this->comment->uuid(), $url);
  }

  /**
   * Overview is the only product tab on the comment canonical.
   */
  public function testOverviewIsTheOnlyCanonicalTab(): void {
    $tasks = $this->container->get('plugin.manager.menu.local_task')->getDefinitions();
    self::assertSame('Overview', (string) $tasks['entity.bb_comment.canonical']['title']);
    self::assertSame('entity.bb_comment.canonical', $tasks['entity.bb_comment.canonical']['base_route']);
    self::assertArrayNotHasKey('entity.bb_comment.edit_form', $tasks);
    self::assertArrayNotHasKey('entity.bb_comment.delete_form', $tasks);
  }

  /**
   * Full body shows author, type, time, table, ticket and sibling-ready zones.
   */
  public function testFullBodyShowsAuthorTypeTimeTicketAndTable(): void {
    $html = $this->renderMode('full');
    self::assertStringContainsString('Ada Lovelace', $html);
    self::assertStringContainsString('summary', $html);
    self::assertStringContainsString('30 Jun 2026, 15:50', $html);
    self::assertStringContainsString('BB-657-END-MARKER', $html);
    self::assertStringContainsString('<td', $html);
    self::assertStringContainsString('BB-142', $html);
    self::assertStringContainsString('coding', $html);
    self::assertStringContainsString($this->ticket->toUrl()->toString(), $html);
    self::assertStringContainsString('data-component-id="bb_theme:canvas"', $html);
    self::assertStringContainsString('data-canvas-region="main"', $html);
    self::assertStringContainsString('data-canvas-region="inspector"', $html);
    self::assertStringContainsString('data-component-id="bb_theme:inspector"', $html);
    self::assertStringNotContainsString('target="_blank"', $html);
    self::assertStringNotContainsString('opens in a new tab', $html);
  }

  /**
   * Teaser canonical link stays in this tab so the shell can swap the page.
   */
  public function testTeaserCanonicalLinkStaysOnThisPage(): void {
    $html = $this->renderMode('teaser');
    self::assertStringContainsString('Open summary comment', $html);
    self::assertStringContainsString($this->comment->toUrl()->toString(), $html);
    self::assertStringNotContainsString('target="_blank"', $html);
    self::assertStringNotContainsString('opens in a new tab', $html);
    self::assertStringNotContainsString('Previous:', $html);
    self::assertStringNotContainsString('Next:', $html);
  }

  /**
   * Canonical breadcrumb is Workspace → Ticket → Comment, empty off that route.
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
    self::assertStringContainsString('keytec', $html);
    self::assertStringContainsString('BB-142', $html);
    self::assertMatchesRegularExpression('/aria-current="page"[^>]*>Comment/', $html);
    self::assertStringContainsString($this->ticket->toUrl()->toString(), $html);
    self::assertStringContainsString('/keytec/tickets', $html);
  }

  /**
   * A type of comment is shown verbatim on full.
   */
  public function testFullShowsTheCommentTypeVerbatim(): void {
    $this->comment->set('type', 'comment')->save();
    $html = $this->renderMode('full');
    self::assertStringContainsString('comment', $html);
  }

  /**
   * Renders the comment in a shipped view mode.
   */
  private function renderMode(string $mode): string {
    $build = $this->container->get('entity_type.manager')
      ->getViewBuilder('bb_comment')
      ->view($this->comment, $mode);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Instantiates the shared-header breadcrumb source.
   */
  private function breadcrumbSource(): BbCommentBreadcrumbSource {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance(
        'bb_comment_breadcrumb',
        SourcePluginBase::buildConfiguration('breadcrumb', $definition, ['source' => []], []),
      );
    self::assertInstanceOf(BbCommentBreadcrumbSource::class, $source);
    return $source;
  }

  /**
   * Stages the canonical comment as the current request.
   */
  private function enterCanonical(): void {
    $route_name = 'entity.bb_comment.canonical';
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $path = str_replace(
      ['{bb_workspace}', '{bb_comment}'],
      [$this->workspace->getSlug(), $this->comment->uuid()],
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
    $request->attributes->set('bb_comment', $this->comment);
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
   * Installs the view modes and displays the canonical page composes.
   */
  private function installCommentCanonicalDisplays(): void {
    $module = $this->container->get('extension.list.module')->getPath('bb_core');
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    $this->writeShippedConfig($target, $module . '/config/install', 'filter.format.bb_rich');
    foreach ([
      'core.entity_view_mode.bb_comment.full' => $module . '/config/optional',
      'core.entity_view_mode.bb_comment.teaser' => $module . '/config/optional',
      'core.entity_view_display.bb_comment.bb_comment.full' => $recipe,
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
    $data['uuid'] = $this->container->get('uuid')->generate();
    $target->write($name, $data);
  }

}
