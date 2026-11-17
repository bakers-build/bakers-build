<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Routing\RouteMatch;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Controller\ProjectFavoriteController;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Profile\Profiles;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * The project overview's favorite toggle: CSRF, project access and ownership.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectFavoriteToggleTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;
  use RailRequestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'og', 'ui_patterns', 'bb_core',
  ];

  /**
   * The project's workspace.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The project under test.
   */
  private BbProjectInterface $project;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group', 'bb_project', 'bb_profile'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->createUser([], 'uid1-dummy');
    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
    $group = $etm->getStorage('bb_group')->create(['name' => 'Platform Group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'Platform',
      'key' => 'PLAT',
      'group_id' => $group->id(),
    ]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;
  }

  /**
   * A request without or with a forged token is refused and stores nothing.
   */
  public function testMissingOrForgedTokenIsRefused(): void {
    $lead = $this->lead();
    self::assertFalse($this->access($lead, NULL), 'no token');
    self::assertFalse($this->access($lead, 'forged'), 'forged token');
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_profile')->loadMultiple());
  }

  /**
   * A viewer marks and unmarks; another account's favorites stay untouched.
   */
  public function testViewerTogglesOwnFavoriteOnly(): void {
    $lead = $this->lead();
    $colleague = $this->lead();
    $this->setCurrentUser($lead);
    $profiles = $this->container->get(Profiles::class);

    self::assertTrue($this->access($lead, $this->validToken()));
    $response = $this->toggle();
    self::assertSame($this->project->toUrl()->setAbsolute()->toString(), $response->getTargetUrl());
    self::assertSame([(int) $this->project->id()], $profiles->forAccount((int) $lead->id(), (int) $this->workspace->id())->favoriteProjectIds());
    self::assertTrue($profiles->forAccount((int) $colleague->id(), (int) $this->workspace->id())->isNew(), 'another account is untouched');

    $this->toggle();
    self::assertSame([], $profiles->forAccount((int) $lead->id(), (int) $this->workspace->id())->favoriteProjectIds());
  }

  /**
   * An account that may not view the project, or anonymous, is refused.
   */
  public function testNonViewerAndAnonymousAreRefused(): void {
    $outsider = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $outsider);
    $this->setCurrentUser($outsider);
    self::assertFalse($this->access($outsider, $this->validToken()));

    $anonymous = User::getAnonymousUser();
    $this->setCurrentUser($anonymous);
    self::assertFalse($this->access($anonymous, $this->validToken()));
  }

  /**
   * The overview offers the toggle, naming the state; elsewhere nothing.
   */
  public function testOverviewActionNamesTheState(): void {
    $this->lead();
    $this->visit('entity.bb_project.canonical', $this->parameters());
    $action = $this->action();
    self::assertSame('Add to favorites', $action['#props']['label']);
    self::assertFalse($action['#props']['pressed']);
    self::assertStringStartsWith('/acme/project/' . $this->project->id() . '/favorite?token=', $action['#props']['href']);
    self::assertContains('user', $action['#cache']['contexts']);

    $this->toggle();
    $action = $this->action();
    self::assertSame('Remove from favorites', $action['#props']['label']);
    self::assertTrue($action['#props']['pressed']);
    self::assertContains('bb_profile_list', $action['#cache']['tags']);

    $this->setCurrentUser(User::getAnonymousUser());
    self::assertArrayNotHasKey('#props', $this->action(), 'anonymous');
    $this->lead();
    $this->visit('bb_core.home');
    self::assertArrayNotHasKey('#props', $this->action(), 'another route');
  }

  /**
   * The favorite action's value on the current route.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function action(): array {
    $source = $this->container->get('plugin.manager.ui_patterns_source')->createInstance(
      'bb_project_favorite_action',
      SourcePluginBase::buildConfiguration('actions', ['type' => 'object'], ['source' => []], []),
    );
    self::assertInstanceOf(SourcePluginBase::class, $source);
    $value = $source->getPropValue();
    self::assertIsArray($value);
    return $value;
  }

  /**
   * A lead of the workspace, made the current account.
   */
  private function lead(): UserInterface {
    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    return $lead;
  }

  /**
   * The token a link to the toggle carries for the current session.
   */
  private function validToken(): string {
    // What a rendered link carries: `Url::toString()` leaves a placeholder.
    return $this->container->get('csrf_token')->get('_workspace/acme/project/' . $this->project->id() . '/favorite');
  }

  /**
   * Whether the route admits the account with the given token.
   */
  private function access(UserInterface $account, ?string $token): bool {
    $request = Request::create('/', 'GET', $token === NULL ? [] : ['token' => $token]);
    $request->setSession($this->container->get('session'));
    $this->container->get('request_stack')->push($request);
    try {
      // checkNamedRoute() would skip the checks that need the request: CSRF.
      $route = $this->container->get('router.route_provider')->getRouteByName('bb_core.project.favorite');
      $raw = $this->parameters() + [
        RouteObjectInterface::ROUTE_NAME => 'bb_core.project.favorite',
        RouteObjectInterface::ROUTE_OBJECT => $route,
      ];
      $upcast = $this->container->get('paramconverter_manager')->convert($raw + $route->getDefaults());
      $match = new RouteMatch('bb_core.project.favorite', $route, $upcast, $this->parameters());
      return $this->container->get('access_manager')->check($match, $account, $request);
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * Runs the toggle as the current account.
   */
  private function toggle(): mixed {
    return $this->container->get('class_resolver')
      ->getInstanceFromDefinition(ProjectFavoriteController::class)
      ->toggle($this->project);
  }

  /**
   * The route parameters for the project.
   *
   * @return array<string, int|string>
   *   Workspace slug and project id.
   */
  private function parameters(): array {
    return ['bb_workspace' => 'acme', 'bb_project' => (int) $this->project->id()];
  }

}
