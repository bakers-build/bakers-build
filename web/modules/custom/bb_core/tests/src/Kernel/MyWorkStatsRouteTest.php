<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Access\BbWorkspaceAccessCheck;
use Drupal\bb_core\Controller\BbStatsController;
use Drupal\bb_core\EventSubscriber\MyWorkSignInSubscriber;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\Core\Routing\RouteMatch;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\Statistics\InsightsFixtureTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\HttpKernelInterface;

/**
 * Covers the My work › Stats page: the account's own figures.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MyWorkStatsRouteTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use UserCreationTrait;
  use InsightsFixtureTrait;

  private const ROUTE = 'bb_core.my_work.stats';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'og',
    'ui_patterns', 'bb_core',
  ];

  /**
   * The workspace the page is opened in.
   */
  private BbWorkspaceInterface $north;

  /**
   * The account whose page is under test.
   */
  private UserInterface $alice;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_conductor', 'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->container->get('router.builder')->rebuild();
    $this->createUser([], 'uid1-dummy');
    $north = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'North', 'slug' => 'north']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $north);
    $north->save();
    $this->north = $north;
    $this->installMyWorkFigures();
    $alice = $this->createUser([], 'alice');
    self::assertInstanceOf(UserInterface::class, $alice);
    $this->addMembership($this->north, $alice, ['contributor']);
    $this->alice = $alice;
  }

  /**
   * The page shows the four tiles, the flow chart and both tables, nothing old.
   */
  public function testPageShowsFourTilesFlowAndTwoTables(): void {
    $this->close($this->project('atlas'), $this->alice);
    $build = $this->page([]);
    $labels = array_map(static fn(array $tile): string => $tile['#props']['label'], $this->components($build, 'bb_theme:stat-tile'));
    self::assertSame(['Throughput', 'Runs per ticket', 'Rating', 'AI usage'], $labels);
    self::assertCount(1, $this->components($build, 'bb_theme:flow-chart'));
    $headings = $this->headings($build);
    self::assertContains('My projects', $headings);
    self::assertContains('My closed tickets', $headings);
    $text = json_encode($build);
    foreach (['Token spend by model', 'Tickets trend', 'CSV', 'There are no statistics to show here.'] as $gone) {
      self::assertStringNotContainsString($gone, (string) $text);
    }
    $descriptions = array_map(static fn(array $zone): string => (string) ($zone['#props']['description'] ?? ''), $this->components($build, 'bb_theme:zone'));
    self::assertContains('Where your closed tickets and runs went.', $descriptions);
    self::assertContains('Most AI usage first.', $descriptions);
  }

  /**
   * Without a closed ticket the page names the period and what it counts.
   */
  public function testEmptyStateNamesThePeriod(): void {
    $build = $this->page([]);
    self::assertSame([], $this->components($build, 'bb_theme:stat-tile'));
    self::assertNotEmpty($this->components($build, 'bb_theme:period-range'), 'The period stays selectable.');
    self::assertCount(1, preg_grep('/^No closed tickets in .+ yet$/', $this->headings($build)) ?: []);
    self::assertStringNotContainsString('There are no statistics to show here.', (string) json_encode($build));
  }

  /**
   * All time without a closed ticket shows the empty state, not empty tiles.
   */
  public function testEmptyStateCoversAllTime(): void {
    $build = $this->page(['filter' => ['period' => 'all']]);
    self::assertSame([], $this->components($build, 'bb_theme:stat-tile'));
    self::assertCount(1, preg_grep('/^No closed tickets in .+ yet$/', $this->headings($build)) ?: []);
  }

  /**
   * The page opens on this month and submits to itself.
   */
  public function testDefaultPeriodIsMonth(): void {
    $range = $this->components($this->page([]), 'bb_theme:period-range')[0]['#props'];
    self::assertSame('month', $range['kind']);
    self::assertSame('/north/stats', $range['action']);
  }

  /**
   * The page offers the Project filter only, listing the account's projects.
   */
  public function testOnlyTheProjectFilterIsOffered(): void {
    $this->close($this->project('atlas'), $this->alice);
    $this->close($this->project('secret'), $this->createUser([], 'bob'));
    $pickers = $this->components($this->page([]), 'bb_theme:option_picker');
    self::assertSame(['insights-filter-project'], array_map(static fn(array $picker): string => $picker['#props']['id'], $pickers));
    $options = $pickers[0]['#slots']['options']['#props']['options'];
    self::assertSame(['atlas'], array_column($options, 'label'));
  }

  /**
   * A bookmarked project of someone else is dropped, never narrowed to.
   */
  public function testForeignProjectBookmarkIsDropped(): void {
    $this->close($this->project('atlas'), $this->alice);
    $secret = $this->project('secret');
    $this->close($secret, $this->createUser([], 'bob'));
    $build = $this->page(['filter' => ['project' => [$secret->uuid()]]]);
    self::assertCount(4, $this->components($build, 'bb_theme:stat-tile'));
    self::assertStringNotContainsString('secret', (string) json_encode($build));
  }

  /**
   * An anonymous visitor is refused; the login redirect handles the rest.
   */
  public function testAnonymousIsRefused(): void {
    $access = $this->container->get('access_manager')->checkNamedRoute(self::ROUTE, ['bb_workspace' => 'north'], new AnonymousUserSession(), TRUE);
    self::assertFalse($access->isAllowed());
  }

  /**
   * An anonymous visitor is sent to sign in and comes back afterwards.
   */
  public function testAnonymousIsSentToSignIn(): void {
    $this->setCurrentUser(new AnonymousUserSession());
    $response = $this->denied(self::ROUTE, '/north/stats?filter[period]=year');
    self::assertInstanceOf(RedirectResponse::class, $response);
    self::assertSame(
      Url::fromRoute('user.login', [], ['query' => ['destination' => '/north/stats?filter[period]=year']])->toString(),
      $response->getTargetUrl(),
    );
  }

  /**
   * A signed-in account, and any other route, keep the workspace boundary.
   */
  public function testOnlyAnonymousStatsVisitsAreRedirected(): void {
    $stranger = $this->createUser([], 'stranger');
    self::assertInstanceOf(UserInterface::class, $stranger);
    $this->setCurrentUser($stranger);
    self::assertNull($this->denied(self::ROUTE, '/north/stats'));
    $this->setCurrentUser(new AnonymousUserSession());
    self::assertNull($this->denied('bb_core.workspace.insights', '/north/insights'));
  }

  /**
   * An unknown slug answers an anonymous visitor exactly like a known one.
   *
   * The unknown slug never reaches the route, so the router's 404 carries no
   * route name; a signed-in account keeps that 404.
   */
  public function testUnknownWorkspaceIsAlsoSentToSignIn(): void {
    $this->setCurrentUser(new AnonymousUserSession());
    $response = $this->denied(NULL, '/no-such-bakery/stats', new NotFoundHttpException());
    self::assertInstanceOf(RedirectResponse::class, $response);
    self::assertSame(
      Url::fromRoute('user.login', [], ['query' => ['destination' => '/no-such-bakery/stats']])->toString(),
      $response->getTargetUrl(),
    );
    self::assertNull($this->denied(NULL, '/no-such-bakery/insights', new NotFoundHttpException()));
    $this->setCurrentUser($this->alice);
    self::assertNull($this->denied(NULL, '/no-such-bakery/stats', new NotFoundHttpException()));
  }

  /**
   * The response the sign-in subscriber gives a refused request, if any.
   */
  private function denied(?string $route, string $uri, ?\Throwable $exception = NULL): ?Response {
    $request = Request::create($uri);
    if ($route !== NULL) {
      $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route);
    }
    $event = new ExceptionEvent(
      $this->container->get('http_kernel'),
      $request,
      HttpKernelInterface::MAIN_REQUEST,
      $exception ?? new AccessDeniedHttpException(BbWorkspaceAccessCheck::WORKSPACE_MISMATCH_REASON),
    );
    $subscriber = $this->container->get('bb_core.my_work_sign_in_subscriber');
    self::assertInstanceOf(MyWorkSignInSubscriber::class, $subscriber);
    $subscriber->onException($event);
    return $event->getResponse();
  }

  /**
   * The page as Alice sees it.
   *
   * @param array<string, mixed> $query
   *   The request query.
   *
   * @return array<string, mixed>
   *   The page render array.
   */
  private function page(array $query): array {
    $this->setCurrentUser($this->alice);
    $route = $this->container->get('router.route_provider')->getRouteByName(self::ROUTE);
    $request = Request::create('/north/stats', 'GET', $query);
    $request->setSession($this->container->get('request_stack')->getCurrentRequest()->getSession());
    $this->container->get('request_stack')->push($request);
    $controller = BbStatsController::create($this->container);
    return $controller->myWork(new RouteMatch(self::ROUTE, $route, ['bb_workspace' => $this->north], ['bb_workspace' => 'north']), $request);
  }

  /**
   * Every plain-text zone heading of a render array.
   *
   * @return array<int, string>
   *   The headings.
   */
  private function headings(array $build): array {
    return array_map(static fn(array $zone): string => (string) ($zone['#slots']['heading']['#plain_text'] ?? ''), $this->components($build, 'bb_theme:zone'));
  }

  /**
   * Every component render array of one id, depth first.
   *
   * @param array<mixed> $build
   *   A render array.
   * @param string $id
   *   The component id.
   *
   * @return array<int, array<string, mixed>>
   *   The matching render arrays.
   */
  private function components(array $build, string $id): array {
    $found = ($build['#component'] ?? NULL) === $id ? [$build] : [];
    foreach ($build as $value) {
      if (is_array($value)) {
        array_push($found, ...$this->components($value, $id));
      }
    }
    return $found;
  }

  /**
   * Creates a project in the north workspace.
   */
  private function project(string $name): BbProjectInterface {
    $storage = $this->container->get('entity_type.manager');
    $group = $storage->getStorage('bb_group')->create(['name' => $name . '-group', 'workspace_id' => $this->north->id()]);
    $group->save();
    $project = $storage->getStorage('bb_project')->create(['name' => $name, 'group_id' => $group->id()]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Closes a ticket assigned to an account just now.
   */
  private function close(BbProjectInterface $project, mixed $assignee): void {
    $now = $this->container->get('datetime.time')->getRequestTime();
    $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'closed',
      'project_id' => $project->id(),
      'assignee_user_id' => $assignee->id(),
      'created' => $now - 1,
      'closed' => TRUE,
      'closed_date' => $now - 1,
    ])->save();
  }

}
