<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\search_api\Entity\Index;
use Drupal\user\UserInterface;
use Drupal\views\Views;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Yaml\Yaml;
use PHPUnit\Framework\Attributes\Group;

/**
 * The project and team Runs tabs, filled as a listing (BB-482).
 *
 * Mirrors TicketListCanvasTest's mechanics for the runs equivalent of the
 * ticket list: a search_api-backed view, composed through a `display_builder`
 * canvas, rendered end to end so a rendered cell — not a config presence — is
 * what every assertion is about.
 */
#[Group('bb_core')]
final class RunListCanvasTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'better_exposed_filters', 'facets', 'facets_exposed_filters',
    'island', 'views_filters_summary',
    'ui_patterns', 'ui_patterns_views', 'display_builder',
    'display_builder_views', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_project',
      'bb_team', 'bb_conductor', 'bb_ticket', 'bb_run', 'bb_term',
      'search_api_task',
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['user', 'search_api', 'views']);
    BbVocabulary::create(['id' => 'bb_labels', 'label' => 'bakers.build labels'])->save();
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'display_builder']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->enableTheShippedDisplayExtender();
    $this->installShippedIndex('search_api.index.bb_runs');
    $this->installShippedView('views.view.runs');
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * The `project_runs` display is gated on `view bb_run`.
   *
   * `renderProjectRuns()` calls `buildRenderable()` directly, which never
   * checks display access — every other test in this class renders past an
   * account that lacks `view bb_run` without noticing, because nothing here
   * asked. `ViewExecutable::access()` is the call the page controller itself
   * makes, so it is what this test exercises instead.
   */
  public function testProjectRunsIsGatedOnTheViewPermission(): void {
    $this->seedThreeRuns();

    $view = Views::getView('runs');
    self::assertNotNull($view, 'The runs view is not installed.');

    $ungranted = $this->createUser(['administer bakers']);
    self::assertInstanceOf(UserInterface::class, $ungranted);
    self::assertFalse(
      $view->access('project_runs', $ungranted),
      'An account without `view bb_run` must be refused the display.',
    );

    $granted = $this->createUser(['view bb_run']);
    self::assertInstanceOf(UserInterface::class, $granted);
    self::assertTrue(
      $view->access('project_runs', $granted),
      'An account holding `view bb_run` must be admitted to the display.',
    );
  }

  /**
   * Past ten rows the mini pager engages, and the eleventh row waits.
   */
  public function testThePagerEngagesPastTenRows(): void {
    $account = $this->createUser(['administer bakers']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);

    $workspace = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);
    $group = $this->create('bb_group', ['name' => 'Platform', 'workspace_id' => $workspace->id()]);
    $project = $this->create('bb_project', ['name' => 'bakers.build', 'key' => 'BB', 'group_id' => $group->id()]);
    $conductor = $this->create('bb_conductor', ['name' => 'cw-framework']);

    for ($i = 0; $i < 11; $i++) {
      $ticket = $this->create('bb_ticket', [
        'title' => 'Ticket ' . $i,
        'state' => 'coding',
        'workflow' => 'bb_feature',
        'project_id' => $project->id(),
      ]);
      $this->create('bb_run', [
        'ticket_id' => $ticket->id(),
        'conductor_id' => $conductor->id(),
        'state' => 'running',
        'state_at_start' => 'coding',
        'agent' => 'opus',
        'started_at' => 1700000000 + $i,
        'duration_s' => 100 + $i,
        'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 3600,
      ]);
    }

    $index = Index::load('bb_runs');
    self::assertNotNull($index);
    self::assertSame(11, $index->indexItems(), 'All eleven runs must be in the index, or the pager assertion proves nothing.');

    $html = $this->renderProjectRuns($project);
    $crawler = new Crawler($html);
    self::assertCount(10, $crawler->filter('[data-component-id="bb_theme:list"] li[data-list-item]'), 'The pager holds the first page to ten rows.');
    self::assertCount(0, $crawler->filter('table'), 'The runs listing renders no table.');
    self::assertStringContainsString('pager', $html, 'A pager element must render once an eleventh row exists.');
  }

  /**
   * A run row fills the approved regions; a zero duration reads "0 s".
   */
  public function testRunRowFillsTheApprovedRegions(): void {
    ['project' => $project] = $this->seedThreeRuns();
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->loadByProperties(['state' => 'failed']);
    $run = reset($run);
    self::assertInstanceOf(ContentEntityInterface::class, $run);
    $run->set('duration_s', 0)->save();
    Index::load('bb_runs')->indexItems();

    $crawler = new Crawler($this->renderProjectRuns($project));
    $items = $crawler->filter('[data-component-id="bb_theme:list"] li[data-list-item]');
    self::assertCount(3, $items);
    // Default sort: started, newest first — the failed run started last.
    $first = $items->eq(0);
    $headline = $first->filter('[data-list-region="headline"]');
    self::assertCount(1, $headline->filter('[data-cell="identifier"] a'));
    self::assertStringContainsString('From', $headline->filter('[data-cell="state_at_start"]')->text());
    $meta = $first->filter('[data-list-region="meta"]');
    self::assertStringContainsString('opus', $meta->text());
    self::assertStringContainsString('Started', $meta->filter('[data-cell="started_at"]')->text());
    $right = $first->filter('[data-list-region="right"] [data-cell="duration_s"]')->text();
    self::assertStringContainsString('Took', $right);
    self::assertMatchesRegularExpression('/\b0 s\b/', $right, 'A zero duration is a value, not an absence.');
  }

  /**
   * The combined duration sort orders the actual rows both ways.
   */
  public function testTheDurationSortOrdersTheRows(): void {
    ['project' => $project] = $this->seedThreeRuns();
    $durations = function (string $sort) use ($project): array {
      $crawler = new Crawler($this->renderProjectRuns($project, 'sort_bef_combine=' . $sort));
      return $crawler->filter('[data-cell="duration_s"]')->each(fn (Crawler $cell) => (int) preg_replace('/\D+/', '', $cell->text()));
    };

    self::assertSame([100, 101, 102], $durations('duration_s_ASC'));
    self::assertSame([102, 101, 100], $durations('duration_s_DESC'));
  }

  /**
   * Search and sort sit in a toolbar above the list, bound to the form.
   *
   * They print outside the exposed form (whose facets stay in the panel) and
   * belong to it through the `form` attribute, so all of them submit together.
   */
  public function testSearchAndSortSitInToolbarBoundToTheForm(): void {
    ['project' => $project] = $this->seedThreeRuns();
    $crawler = new Crawler($this->renderProjectRuns($project));

    $form = $crawler->filter('form.views-exposed-form');
    self::assertCount(1, $form);
    $form_id = $form->attr('id');
    self::assertCount(0, $form->filter('[name="title"], [name="sort_bef_combine"]'), 'Search and sort no longer print inside the form.');

    $toolbar = $crawler->filter('[role="search"]');
    self::assertCount(1, $toolbar, 'The search-and-sort toolbar renders once.');
    foreach (['title', 'sort_bef_combine'] as $name) {
      $field = $toolbar->filter('[name="' . $name . '"]');
      self::assertCount(1, $field, "The toolbar holds $name.");
      self::assertSame($form_id, $field->attr('form'), "$name belongs to the exposed form.");
    }
    self::assertSame('search', $toolbar->filter('[name="title"]')->attr('type'));
    // The toolbar comes before the rows.
    $html = $crawler->html();
    self::assertLessThan(strpos($html, 'data-list-item'), strpos($html, 'role="search"'));
  }

  /**
   * The search narrows runs by their ticket's title.
   */
  public function testTheSearchNarrowsRunsByTicketTitle(): void {
    ['project' => $project] = $this->seedThreeRuns();
    $crawler = new Crawler($this->renderProjectRuns($project, 'title=failed'));

    $items = $crawler->filter('[data-component-id="bb_theme:list"] li[data-list-item]');
    self::assertCount(1, $items, 'Only the run of "Ticket failed" matches.');
  }

  /**
   * The tie-breaker follows the chosen direction for equal values.
   */
  public function testTheTieBreakerFollowsTheChosenDirection(): void {
    ['project' => $project] = $this->seedThreeRuns();
    // Every seeded run took a different time; make two of them equal.
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    foreach ($storage->loadMultiple() as $run) {
      self::assertInstanceOf(ContentEntityInterface::class, $run);
      $run->set('duration_s', 7)->save();
    }
    Index::load('bb_runs')->indexItems();
    $order = function (string $sort) use ($project): array {
      $crawler = new Crawler($this->renderProjectRuns($project, 'sort_bef_combine=' . $sort));
      return $crawler->filter('[data-cell="identifier"]')->each(fn (Crawler $cell) => trim($cell->text()));
    };

    $ascending = $order('duration_s_ASC');
    self::assertCount(3, $ascending);
    self::assertSame(array_reverse($ascending), $order('duration_s_DESC'));
  }

  /**
   * With no runs, the contextual empty text renders.
   */
  public function testAnEmptyProjectStatesItsContextualEmptyText(): void {
    $account = $this->createUser(['administer bakers']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);
    $workspace = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);
    $group = $this->create('bb_group', ['name' => 'Platform', 'workspace_id' => $workspace->id()]);
    $project = $this->create('bb_project', ['name' => 'Empty', 'key' => 'EMP', 'group_id' => $group->id()]);
    $index = Index::load('bb_runs');
    self::assertNotNull($index);
    $index->indexItems();

    $html = $this->renderProjectRuns($project);
    self::assertStringContainsString('No runs yet.', $html);
  }

  /**
   * A project, a group, a workspace, a conductor and three runs, indexed.
   *
   * @return array{project: \Drupal\Core\Entity\ContentEntityInterface, team: \Drupal\Core\Entity\ContentEntityInterface}
   *   The seeded project and team.
   */
  private function seedThreeRuns(): array {
    $account = $this->createUser(['administer bakers']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);

    $workspace = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);
    $group = $this->create('bb_group', ['name' => 'Platform', 'workspace_id' => $workspace->id()]);
    $team = $this->create('bb_team', ['name' => 'Core team', 'workspace_id' => $workspace->id()]);
    $project = $this->create('bb_project', [
      'name' => 'bakers.build',
      'key' => 'BB',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    $conductor = $this->create('bb_conductor', ['name' => 'cw-framework']);

    foreach (['running', 'done', 'failed'] as $i => $state) {
      $ticket = $this->create('bb_ticket', [
        'title' => 'Ticket ' . $state,
        'state' => 'coding',
        'workflow' => 'bb_feature',
        'project_id' => $project->id(),
      ]);
      $this->create('bb_run', [
        'ticket_id' => $ticket->id(),
        'conductor_id' => $conductor->id(),
        'state' => $state,
        'state_at_start' => 'coding',
        'agent' => 'opus',
        'started_at' => 1700000000 + $i,
        'duration_s' => 100 + $i,
        'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 3600,
      ]);
    }

    $index = Index::load('bb_runs');
    self::assertNotNull($index);
    self::assertSame(3, $index->indexItems(), 'All three runs must be in the index, or an empty answer proves nothing.');

    return ['project' => $project, 'team' => $team];
  }

  /**
   * Turns the display-builder extender on, from the object the repo ships.
   *
   * A KERNEL TEST DOES NOT RUN `hook_install()`, so
   * `display_builder_views_install()` — the thing that appends
   * `display_builder` to `views.settings` › `display_extenders` — never
   * fires. Without this the view renders as a bare Views table with no
   * canvas at all.
   */
  private function enableTheShippedDisplayExtender(): void {
    $file = dirname(__DIR__, 7) . '/config/sync/views.settings.yml';
    self::assertFileExists($file, 'The repository ships views.settings.');
    $shipped = Yaml::parseFile($file);
    self::assertIsArray($shipped);
    self::assertContains(
      'display_builder',
      $shipped['display_extenders'] ?? [],
      'config/sync/views.settings.yml must name the display_builder extender.',
    );
    $this->config('views.settings')
      ->set('display_extenders', $shipped['display_extenders'])
      ->save();
  }

  /**
   * Installs the bb_runs Search API index from its recipe copy.
   *
   * @param string $name
   *   The config object name, e.g. `search_api.index.bb_runs`.
   */
  private function installShippedIndex(string $name): void {
    $path = dirname(__DIR__, 7) . '/recipes/bakers/config/' . $name . '.yml';
    self::assertFileExists($path, "$name is not shipped in recipes/bakers/config.");
    $data = Yaml::parseFile($path);
    self::assertIsArray($data, "$name did not parse as a YAML mapping.");
    $storage = $this->container->get('entity_type.manager')->getStorage('search_api_index');
    if ($storage->load($data['id']) === NULL) {
      $storage->create($data)->save();
    }
  }

  /**
   * Installs the `runs` view from its recipe copy.
   *
   * @param string $name
   *   The config object name, e.g. `views.view.runs`.
   */
  private function installShippedView(string $name): void {
    $path = dirname(__DIR__, 7) . '/recipes/bakers/config/' . $name . '.yml';
    self::assertFileExists($path, "$name is not shipped in recipes/bakers/config.");
    $data = Yaml::parseFile($path);
    self::assertIsArray($data, "$name did not parse as a YAML mapping.");
    $storage = $this->container->get('entity_type.manager')->getStorage('view');
    if ($storage->load($data['id']) === NULL) {
      $storage->create($data)->save();
    }
  }

  /**
   * Renders the `project_runs` display for a given project.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $project
   *   The project.
   * @param string $query
   *   An optional query string, without a leading `?`.
   *
   * @return string
   *   The rendered markup.
   */
  private function renderProjectRuns(ContentEntityInterface $project, string $query = ''): string {
    return $this->renderDisplay(
      'project_runs',
      '/bakers/project/' . $project->id() . '/runs',
      ['bakers', (string) $project->id()],
      $query,
    );
  }

  /**
   * Renders a page display of the `runs` view with a pushed request.
   *
   * @param string $display_id
   *   The display id.
   * @param string $path
   *   The address the request is pushed at.
   * @param array<int, string> $arguments
   *   The contextual filter values, in the display's declared order.
   * @param string $query
   *   An optional query string, without a leading `?`.
   *
   * @return string
   *   The rendered markup.
   */
  private function renderDisplay(string $display_id, string $path, array $arguments, string $query): string {
    $request = Request::create($path . ($query === '' ? '' : '?' . $query));
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add(
      $this->container->get('router')->matchRequest($request)
    );
    $this->container->get('request_stack')->push($request);
    try {
      $view = Views::getView('runs');
      self::assertNotNull($view, 'The runs view is not installed.');
      $build = $view->buildRenderable($display_id, $arguments);
      return (string) $this->container->get('renderer')->renderInIsolation($build);
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * Creates and saves an entity of the given type.
   *
   * @param string $entity_type_id
   *   The entity type id.
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved entity.
   */
  private function create(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

}
