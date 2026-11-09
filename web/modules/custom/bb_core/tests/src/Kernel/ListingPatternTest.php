<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\file\Entity\File;
use Drupal\bb_core\Reference\ReferenceCounter;
use Drupal\user\UserInterface;
use Drupal\views\ViewExecutable;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DomCrawler\Crawler;

/**
 * The `bb_list` style renders the SQL listings as patterned list rows.
 *
 * Projects and groups are the two SQL views on the style; tickets and runs are
 * covered through their Search API worlds in `TicketsViewTableTest` and
 * `RunListCanvasTest`. This class also pins the style contract itself: the
 * pattern validation and that the table renderer stays available to views
 * that do not opt in.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ListingPatternTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;
  use ProjectsViewTestTrait;
  use ShippedImageConfigTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'crop',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'views', 'better_exposed_filters',
    'ui_patterns', 'ui_patterns_views', 'display_builder',
    'display_builder_views',
    'bb_core',
  ];

  /**
   * The account every render is performed as; it bypasses the read scope.
   */
  private UserInterface $reader;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installEntitySchema('file');
    $this->installSchema('file', ['file_usage']);
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    $this->installConfig(['views']);
    $this->installShippedView('views.view.projects');
    $this->installShippedView('views.view.groups');
    $this->installEntitySchema('crop');
    $this->installAvatarStyle();
    $this->container->get('router.builder')->rebuild();
    // The presenter template lives in the theme.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->reader = $this->createAccount('listing-reader', [
      'administer bakers',
      'view bb_project',
      'view bb_group',
      'access user profiles',
      'view bb_ticket',
    ]);
    // Counts run with access checks, and the read scope follows membership.
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $this->reader, []);
  }

  /**
   * A project row: its name without the key, three counts, and creation.
   */
  public function testProjectRowFillsTheApprovedRegions(): void {
    $project = $this->fixture('a', 'bb_project');
    $item = $this->itemFor($this->renderListing('projects'), (string) $project->label());

    $headline = $this->region($item, 'headline');
    self::assertStringContainsString('project-a', $headline);
    self::assertStringNotContainsString('data-cell="key"', $item, 'A project row renders no key.');
    self::assertCount(0, (new Crawler($item))->filter('[data-list-region="meta"]'), 'Projects carry no meta line.');
    self::assertSame(['open_tickets', 'conductor_tickets', 'closed_tickets'], $this->cellIds($item, 'right'));
    self::assertCount(3, (new Crawler($this->region($item, 'right')))->filter('[data-component-id="bb_theme:badge"] svg'), 'Every count carries an icon.');
    $right_meta = $this->region($item, 'right_meta');
    self::assertStringContainsString('Created', $right_meta);
    // The request time is fixed at setUp: a later fixture reads "in …".
    self::assertMatchesRegularExpression('/\\d+ \\w+ ago|in \\d+ \\w+/', $right_meta);
    self::assertStringNotContainsString('<table', $item);
  }

  /**
   * Open, open-with-a-conductor and closed tickets, each explained on hover.
   */
  public function testProjectCountsOpenConductorAndClosedTickets(): void {
    $project = $this->fixture('a', 'bb_project');
    $before = $this->ticketCount($project->id());
    $conductor = $this->createEntity('bb_conductor', [
      'label' => 'counted-conductor',
      'project_id' => $project->id(),
      'owner_user_id' => $this->reader->id(),
    ]);
    $this->createEntity('bb_ticket', [
      'title' => 'Open with a conductor',
      'workflow' => 'bb_work',
      'state' => 'working',
      'project_id' => $project->id(),
      'conductor_id' => $conductor->id(),
    ]);
    $this->createEntity('bb_ticket', [
      'title' => 'Closed with a conductor',
      'workflow' => 'bb_work',
      'state' => 'done',
      'closed' => TRUE,
      'project_id' => $project->id(),
      'conductor_id' => $conductor->id(),
    ]);
    $this->createEntity('bb_ticket', [
      'title' => 'Open one',
      'workflow' => 'bb_work',
      'state' => 'working',
      'project_id' => $project->id(),
    ]);
    $this->createEntity('bb_ticket', [
      'title' => 'Closed one',
      'workflow' => 'bb_work',
      'state' => 'done',
      'closed' => TRUE,
      'project_id' => $project->id(),
    ]);
    $titles = $this->badgeTitles($this->itemFor($this->renderListing('projects'), (string) $project->label()));

    $plural = fn (int $count, string $one, string $many): string => $count === 1 ? $one : str_replace('@count', (string) $count, $many);
    self::assertSame([
      $plural($before['open'] + 2, '1 open ticket', '@count open tickets'),
      $plural($before['conductor'] + 1, '1 open ticket with a conductor', '@count open tickets with a conductor'),
      $plural($before['closed'] + 2, '1 closed ticket', '@count closed tickets'),
    ], $titles);
  }

  /**
   * The counter answers a whole result set at once and caches per request.
   */
  public function testReferenceCounterCountsOnceAndCachesPerRequest(): void {
    $project = $this->fixture('a', 'bb_project');
    $other = $this->fixture('b', 'bb_project');
    $counter = $this->container->get('bb_core.reference_counter');
    // A plain member of workspace A: no scope bypass.
    $member = $this->createAccount('listing-member', ['view bb_project', 'view bb_ticket']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $member, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $member, []);
    $this->container->get('account_switcher')->switchTo($member);
    try {
      $first = $counter->count('bb_ticket', 'project_id', [$project->id(), $other->id()]);
      self::assertSame($this->ticketCount($project->id())['all'], $first[$project->id()]);
      self::assertGreaterThan(0, $this->ticketCount($other->id())['all'], 'Workspace B holds no ticket, so its zero proves nothing.');
      // Workspace B is outside the member's scope: it counts as nothing.
      self::assertSame(0, $first[$other->id()]);

      // A ticket created after the first answer does not trigger a re-count:
      // later rows and fields of the same request read the cache.
      $this->createEntity('bb_ticket', [
        'title' => 'Created after counting',
        'workflow' => 'bb_work',
        'project_id' => $project->id(),
      ]);
      self::assertSame($first[$project->id()], $counter->count('bb_ticket', 'project_id', [$project->id()])[$project->id()]);
      // A different condition is its own cache entry.
      self::assertSame($this->ticketCount($project->id())['open'], $counter->count('bb_ticket', 'project_id', [$project->id()], ['closed' => 0])[$project->id()]);
    }
    finally {
      $this->container->get('account_switcher')->switchBack();
    }
  }

  /**
   * A reader who may not see tickets counts none of them.
   */
  public function testCountsOnlyIncludeWhatTheReaderMaySee(): void {
    $project = $this->fixture('a', 'bb_project');
    self::assertGreaterThan(0, $this->ticketCount($project->id())['all'], 'The fixture holds no ticket, so a zero proves nothing.');
    $limited = $this->createAccount('listing-limited', ['view bb_project', 'view bb_group']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $limited, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $limited, []);
    $titles = $this->badgeTitles($this->itemFor($this->renderView($this->executed('projects', [], NULL, NULL, $limited), $limited), (string) $project->label()));

    self::assertSame(['0 open tickets', '0 open tickets with a conductor', '0 closed tickets'], $titles);
  }

  /**
   * A cached project row recounts once a ticket is added to the project.
   *
   * Kernel tests keep the render cache on, so the second render reads the
   * cached row unless the badge carries the ticket list cache tag. A project
   * created in this request reads "Created 0 seconds ago", whose max-age 0
   * keeps the row out of the cache entirely; two days back makes it
   * cacheable, as a real listing row is.
   */
  public function testCachedProjectCountsRefreshWhenTicketIsAdded(): void {
    $project = $this->fixture('a', 'bb_project');
    $project->set('created', $this->container->get('datetime.time')->getRequestTime() - 2 * 86400)->save();
    $open = fn (): string => $this->badgeTitles($this->itemFor($this->renderListing('projects'), (string) $project->label()))[0];
    $before = $open();

    $this->createEntity('bb_ticket', [
      'title' => 'Added after the first render',
      'workflow' => 'bb_work',
      'state' => 'working',
      'project_id' => $project->id(),
    ]);
    $this->startNewRequest();

    self::assertNotSame($before, $open());
    self::assertSame($this->ticketCount($project->id())['open'] . ' open tickets', $open());
  }

  /**
   * A cached group row recounts once a project moves into the group.
   *
   * Moving an existing project creates no membership, so nothing but the
   * badge's own tag can refresh the cached row. A group changed in this
   * request reads "Updated 0 seconds ago", whose max-age 0 keeps the row out
   * of the cache entirely; two days back makes it cacheable, as a real
   * listing row is.
   */
  public function testCachedGroupCountRefreshesWhenProjectMovesIn(): void {
    $group = $this->fixture('a', 'bb_group');
    $group->set('changed', $this->container->get('datetime.time')->getRequestTime() - 2 * 86400)->save();
    $other_group = $this->createEntity('bb_group', [
      'name' => 'group-a-second',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
    ]);
    $project = $this->createEntity('bb_project', [
      'name' => 'project-a-second',
      'group_id' => $other_group->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
    ]);
    $count = fn (): array => $this->badgeTitles($this->itemFor($this->renderListing('groups'), (string) $group->label()));
    self::assertSame(['1 project'], $count());

    $project->set('group_id', $group->id())->save();
    $this->startNewRequest();

    self::assertSame(['2 projects'], $count());
  }

  /**
   * A group row: its name, then its project count and when it last changed.
   */
  public function testGroupRowShowsProjectCountAndLastChange(): void {
    $group = $this->fixture('a', 'bb_group');
    $item = $this->itemFor($this->renderListing('groups'), (string) $group->label());

    self::assertStringContainsString('group-a', $this->region($item, 'headline'));
    self::assertCount(0, (new Crawler($item))->filter('[data-list-region="meta"]'), 'Groups carry no meta line.');
    self::assertSame(['1 project'], $this->badgeTitles($item));
    $right_meta = $this->region($item, 'right_meta');
    self::assertStringContainsString('Updated', $right_meta);
    self::assertMatchesRegularExpression('/\\d+ \\w+ ago|in \\d+ \\w+/', $right_meta);
  }

  /**
   * An empty right-hand value reads as a faint dash, never as a blank.
   */
  public function testEmptyRightValueReadsAsFaintDash(): void {
    $view = $this->executed('projects');
    // The description, moved right and rewritten to nothing for every row.
    $view->style_plugin->options['pattern'] = ['headline' => ['name'], 'meta' => [], 'right' => ['description']];
    $view->field['description']->options['alter']['alter_text'] = TRUE;
    $view->field['description']->options['alter']['text'] = ' ';
    $view->field['description']->options['hide_empty'] = TRUE;
    $right = $this->region($this->firstItem($this->renderView($view)), 'right');

    self::assertStringContainsString('—', $right);
    self::assertStringContainsString('text-text-faint', $right);
  }

  /**
   * Every combined sort orders the SQL rows; equal values follow the direction.
   */
  public function testCombinedSortsOrderTheRows(): void {
    $workspace = $this->fixture('a', 'bb_workspace');
    $group = $this->fixture('a', 'bb_group');
    $team = $this->fixture('a', 'bb_team');
    // The page display's route needs a slug to build the form action.
    $workspace->set('slug', 'workspace-a')->save();
    // Lower case: SQLite's default collation is binary.
    foreach (['zulu', 'alpha', 'mike'] as $name) {
      $this->createEntity('bb_project', [
        'name' => $name,
        'group_id' => $group->id(),
        'teams' => [$team->id()],
        'owner_user_id' => $this->reader->id(),
      ]);
    }
    $names = fn (string $sort): array => array_map(
      fn ($row) => (string) $row->_entity->label(),
      $this->executed('projects', ['sort_bef_combine' => $sort], (string) $workspace->get('slug')->value)->result,
    );

    self::assertSame(['alpha', 'mike', 'project-a', 'zulu'], $names('name_ASC'));
    self::assertSame(['zulu', 'project-a', 'mike', 'alpha'], $names('name_DESC'));
    // One group for all four: the id tie-breaker decides, in the chosen
    // direction, so Z–A reverses even equal groups.
    $tied = $names('name_1_ASC');
    self::assertSame(['project-a', 'zulu', 'alpha', 'mike'], $tied);
    self::assertSame(array_reverse($tied), $names('name_1_DESC'));
  }

  /**
   * The projects search matches a name or a key.
   */
  public function testProjectSearchMatchesNameOrKey(): void {
    $workspace = $this->fixture('a', 'bb_workspace');
    $workspace->set('slug', 'workspace-a')->save();
    $project = $this->createEntity('bb_project', [
      'name' => 'needle project',
      'key' => 'NDL',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
      'owner_user_id' => $this->reader->id(),
    ]);
    $ids = fn (string $search): array => array_map(
      fn ($row) => (int) $row->_entity->id(),
      $this->executed('projects', ['title' => $search], 'workspace-a')->result,
    );

    self::assertSame([(int) $project->id()], $ids('needle'), 'A name matches.');
    self::assertSame([(int) $project->id()], $ids('NDL'), 'A key matches.');
  }

  /**
   * The style rejects unknown, excluded and doubly assigned field IDs.
   */
  public function testPatternValidationRejectsBadFieldIds(): void {
    $view = Views::getView('projects');
    $view->setDisplay('default');
    $view->initStyle();
    /** @var \Drupal\views\Plugin\views\field\FieldPluginBase $key */
    $key = $view->display_handler->getHandlers('field')['key'];
    $key->options['exclude'] = TRUE;
    $view->style_plugin->options['pattern'] = [
      'headline' => ['name', 'nope'],
      'meta' => ['name', 'key'],
      'right' => [],
    ];
    $errors = array_map('strval', $view->style_plugin->validate());

    self::assertContains('The headline region names the unknown field nope.', $errors);
    self::assertContains('The meta region names the excluded field key.', $errors);
    self::assertContains('The field name is assigned to more than one region.', $errors);
  }

  /**
   * An image leads the row; the description follows the title, escaped.
   *
   * Its line breaks are kept as breaks.
   */
  public function testImageLeadsAndDescriptionFollowsTheTitle(): void {
    foreach (['projects' => 'bb_project', 'groups' => 'bb_group'] as $view_id => $entity_type_id) {
      $subject = $this->fixture('a', $entity_type_id);
      $subject->set('image', $this->privateImage($entity_type_id));
      $subject->set('description', "Ships the <b>parser</b>\nschnell und grün.");
      $subject->save();
      $item = $this->itemFor($this->renderListing($view_id), (string) $subject->label());

      $order = (new Crawler($item))->filter('[data-list-region]')->each(
        static fn (Crawler $region): string => (string) $region->attr('data-list-region'),
      );
      self::assertSame('avatar', $order[0], "$view_id: the avatar comes first.");
      self::assertLessThan(array_search('description', $order, TRUE), array_search('headline', $order, TRUE), "$view_id: the description follows the title.");
      $avatar = new Crawler($this->region($item, 'avatar'));
      self::assertCount(1, $avatar->filter('img'), "$view_id: the image is the avatar.");
      // The square crop's derivative, still served through the private
      // download route that re-checks the original's access.
      self::assertStringContainsString('/system/files/styles/avatar/private/', (string) $avatar->filter('img')->attr('src'));
      self::assertStringContainsString('object-contain', (string) $avatar->filter('img')->attr('class'));
      $description = $this->region($item, 'description');
      self::assertStringContainsString('&lt;b&gt;parser&lt;/b&gt;', $description, 'Markup in the description is text.');
      self::assertStringContainsString('schnell und grün', $description);
      self::assertSame(1, substr_count($description, '<br'), "$view_id: the second line starts on its own line.");
    }
  }

  /**
   * Without an image the avatar is initials; without a description, nothing.
   */
  public function testMissingImageAndDescriptionLeaveInitialsAndNoGap(): void {
    foreach (['projects' => 'bb_project', 'groups' => 'bb_group'] as $view_id => $entity_type_id) {
      $subject = $this->fixture('a', $entity_type_id);
      $subject->set('name', 'Überblick Ärger');
      // A reference to a file that no longer exists falls back as well.
      $subject->set('image', ['target_id' => 987654]);
      $subject->set('description', '   ');
      $subject->save();
      $item = $this->itemFor($this->renderListing($view_id), 'Überblick Ärger');

      $avatar = new Crawler($this->region($item, 'avatar'));
      self::assertCount(0, $avatar->filter('img'));
      self::assertSame('ÜÄ', trim($avatar->text()));
      self::assertCount(0, (new Crawler($item))->filter('[data-list-region="description"]'), "$view_id: an empty description renders no region.");
    }
  }

  /**
   * A reader who may not download the image sees initials, not the file.
   */
  public function testAnInaccessibleImageFallsBackToInitials(): void {
    $group = $this->fixture('a', 'bb_group');
    $group->set('image', $this->privateImage('bb_group'))->save();
    $outsider = $this->createAccount('listing-outsider', []);
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($outsider);
    try {
      $build = $group->get('name')->view(['type' => 'bb_entity_avatar', 'label' => 'hidden']);
      $html = (string) $this->container->get('renderer')->renderInIsolation($build);
    }
    finally {
      $switcher->switchBack();
    }
    self::assertStringNotContainsString('<img', $html);
    self::assertStringContainsString('data-person-mark', $html);
  }

  /**
   * A re-crop or a restyle reaches the avatar without a cache clear.
   *
   * The crop belongs to the file, so saving it invalidates the file's tags;
   * the avatar must carry those and the style's.
   */
  public function testTheAvatarCarriesTheFileAndStyleCacheTags(): void {
    foreach (['bb_project', 'bb_group'] as $entity_type_id) {
      $subject = $this->fixture('a', $entity_type_id);
      $fid = $this->privateImage($entity_type_id);
      $subject->set('image', $fid)->save();
      $switcher = $this->container->get('account_switcher');
      $switcher->switchTo($this->reader);
      try {
        $build = $subject->get('name')->view(['type' => 'bb_entity_avatar', 'label' => 'hidden']);
      }
      finally {
        $switcher->switchBack();
      }
      $tags = $build[0]['#cache']['tags'] ?? [];
      self::assertContains('file:' . $fid, $tags, "$entity_type_id: the file's tag.");
      self::assertContains('config:image.style.avatar', $tags, "$entity_type_id: the style's tag.");
      // The style URL is absolute, so it varies by the host it was built for.
      self::assertContains('url.site', $build[0]['#cache']['contexts'] ?? [], "$entity_type_id: the site context.");
    }
  }

  /**
   * A permanent private PNG under the entity type's image directory.
   */
  private function privateImage(string $entity_type_id): int {
    $directory = 'private://' . ($entity_type_id === 'bb_group' ? 'group' : 'project') . '-images';
    $file_system = $this->container->get('file_system');
    $file_system->prepareDirectory($directory, 1);
    $uri = $directory . '/avatar-' . $entity_type_id . '.png';
    file_put_contents($uri, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
    $file = File::create(['uri' => $uri, 'status' => 1]);
    $file->save();
    return (int) $file->id();
  }

  /**
   * A view that keeps the table style still renders the table component.
   */
  public function testTheTableRendererStaysAvailable(): void {
    $view = Views::getView('projects');
    $view->setDisplay('default');
    $display = $view->displayHandlers->get('default');
    $display->setOption('style', ['type' => 'table', 'options' => []]);
    $html = $this->renderView($this->executed('projects', [], NULL, $view));

    self::assertStringContainsString('data-component-id="bb_theme:table"', $html);
    self::assertStringNotContainsString('data-list-region', $html);
  }

  /**
   * Executes a view's default display for workspace A as the reader.
   *
   * @param string $view_id
   *   The view.
   * @param array<string, string> $query
   *   Query arguments, such as a combined sort.
   * @param string|null $argument
   *   The workspace argument; workspace A's id when NULL.
   * @param \Drupal\views\ViewExecutable|null $view
   *   A prepared view to execute instead of a fresh one.
   * @param \Drupal\user\UserInterface|null $account
   *   The account to execute as; the scope-bypassing reader when NULL.
   *
   * @return \Drupal\views\ViewExecutable
   *   The executed view.
   */
  private function executed(string $view_id, array $query = [], ?string $argument = NULL, ?ViewExecutable $view = NULL, ?UserInterface $account = NULL): ViewExecutable {
    $this->container->get('request_stack')->getCurrentRequest()?->query->replace($query);
    $view ??= Views::getView($view_id);
    $display = $argument === NULL ? 'default' : 'workspace_list';
    $view->setDisplay($display);
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account ?? $this->reader);
    try {
      $view->preExecute([$argument ?? (string) $this->fixture('a', 'bb_workspace')->id()]);
      $view->execute($display);
    }
    finally {
      $switcher->switchBack();
    }
    self::assertNotEmpty($view->result, "The $view_id view returned nothing.");
    return $view;
  }

  /**
   * Executes and renders a view's style output.
   */
  private function renderListing(string $view_id): string {
    return $this->renderView($this->executed($view_id));
  }

  /**
   * Renders an executed view's style output as the reader.
   */
  private function renderView(ViewExecutable $view, ?UserInterface $account = NULL): string {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account ?? $this->reader);
    try {
      $build = $view->style_plugin->render();
      return (string) $this->container->get('renderer')->renderInIsolation($build);
    }
    finally {
      $switcher->switchBack();
    }
  }

  /**
   * Drops the request-scoped counter memo, as a new request would.
   */
  private function startNewRequest(): void {
    $this->container->set('bb_core.reference_counter', new ReferenceCounter(
      $this->container->get('entity_type.manager'),
      $this->container->get('current_user'),
    ));
  }

  /**
   * A project's tickets by kind, counted without access checks.
   *
   * @return array{open: int, conductor: int, closed: int, all: int}
   *   The two counts.
   */
  private function ticketCount(int|string $project_id): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $all = (int) $storage->getQuery()->accessCheck(FALSE)->condition('project_id', $project_id)->count()->execute();
    $open = (int) $storage->getQuery()->accessCheck(FALSE)->condition('project_id', $project_id)->condition('closed', 0)->count()->execute();
    $conductor = (int) $storage->getQuery()->accessCheck(FALSE)->condition('project_id', $project_id)->condition('closed', 0)->exists('conductor_id')->count()->execute();
    return ['open' => $open, 'conductor' => $conductor, 'closed' => $all - $open, 'all' => $all];
  }

  /**
   * The data-cell ids of one region, in order.
   *
   * @return list<string>
   *   The cell ids.
   */
  private function cellIds(string $item, string $region): array {
    return (new Crawler($item))->filter("[data-list-region=\"$region\"] > [data-cell]")->each(
      static fn (Crawler $cell): string => (string) $cell->attr('data-cell'),
    );
  }

  /**
   * The explaining titles of the count badges in the right-hand column.
   *
   * @return list<string>
   *   One title per badge, in order.
   */
  private function badgeTitles(string $item): array {
    return (new Crawler($item))->filter('[data-list-region="right"] [data-component-id="bb_theme:badge"]')->each(
      static fn (Crawler $badge): string => (string) $badge->attr('title'),
    );
  }

  /**
   * The list item whose name cell reads a label.
   */
  private function itemFor(string $html, string $label): string {
    $items = (new Crawler($html))->filter('li[data-list-item]')
      ->reduce(fn (Crawler $item): bool => $item->filter('[data-list-region="headline"] [data-cell="name"]')->reduce(
        fn (Crawler $cell): bool => trim($cell->text()) === $label,
      )->count() > 0);
    self::assertCount(1, $items, "No single item is named $label.");
    return $items->outerHtml();
  }

  /**
   * The first list item.
   */
  private function firstItem(string $html): string {
    $items = (new Crawler($html))->filter('li[data-list-item]');
    self::assertGreaterThan(0, $items->count(), 'The list rendered no item.');
    return $items->first()->outerHtml();
  }

  /**
   * One region of an item.
   */
  private function region(string $item, string $region): string {
    $nodes = (new Crawler($item))->filter(sprintf('[data-list-region="%s"]', $region));
    self::assertCount(1, $nodes, "The item has no single $region region.");
    return $nodes->outerHtml();
  }

}
