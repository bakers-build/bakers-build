<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\og\Og;
use Drupal\Component\Serialization\Yaml;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\Core\Routing\RouteMatch;
use Drupal\bb_api_key\Access\ApiKeyAccess;
use Drupal\bb_api_key\Access\ServiceAccountAccess;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgMembership;
use Drupal\og\Entity\OgRole;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Routing\Route;

/**
 * Service Accounts route/tab/form access composition.
 *
 * Covers `ServiceAccountAccess`'s route-level methods, swapped-id denial, and
 * that every management route restricts authentication to a cookie session
 * — a bearer key must never administer identities or credentials.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ServiceAccountAccessTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'markdown_easy', 'field', 'state_machine', 'entity', 'og',
    'consumers', 'simple_oauth', 'views', 'bb_core', 'bb_api_key',
  ];

  /**
   * The workspace the Lead administers.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * A second, unrelated workspace.
   */
  private BbWorkspaceInterface $foreignWorkspace;

  /**
   * A team inside the administered workspace.
   */
  private BbTeamInterface $team;

  /**
   * An account with the workspace's `lead` rank.
   */
  private UserInterface $lead;

  /**
   * An ordinary member of the workspace, with no `update` access.
   */
  private UserInterface $member;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_team');
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('consumer');
    $this->installEntitySchema('oauth2_token');
    $this->installConfig(['system', 'user', 'og', 'bb_core', 'bb_api_key', 'simple_oauth']);
    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'grant_types' => ['client_credentials' => ['status' => TRUE]],
      'umbrella' => TRUE,
    ])->save();

    Og::addGroup('bb_workspace', 'bb_workspace');
    Og::addGroup('bb_team', 'bb_team');

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_workspace');
    $workspace = $storage->create(['name' => 'Acme', 'slug' => 'acme']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    $this->workspace = $workspace;

    $foreign = $storage->create(['name' => 'Other', 'slug' => 'other']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $foreign);
    $foreign->save();
    $this->foreignWorkspace = $foreign;

    $team = $this->container->get('entity_type.manager')->getStorage('bb_team')->create([
      'name' => 'API home',
      'workspace_id' => $this->workspace->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    $this->team = $team;

    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->lead = $lead;
    $leadRole = OgRole::load('bb_workspace-bb_workspace-lead');
    self::assertInstanceOf(OgRole::class, $leadRole);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($this->lead)
      ->setGroup($this->workspace)
      ->setRoles([$leadRole])
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $member = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $member);
    $this->member = $member;
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($this->member)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
  }

  /**
   * The access service under test.
   */
  private function access(): ServiceAccountAccess {
    $access = $this->container->get(ServiceAccountAccess::class);
    self::assertInstanceOf(ServiceAccountAccess::class, $access);
    return $access;
  }

  /**
   * The lifecycle manager, to set up fixture service accounts.
   */
  private function manager(): ServiceAccountManager {
    $manager = $this->container->get(ServiceAccountManager::class);
    self::assertInstanceOf(ServiceAccountManager::class, $manager);
    return $manager;
  }

  /**
   * The workspace administrator may create, an ordinary member may not.
   */
  public function testCreateAccountGatedOnWorkspaceUpdateAccess(): void {
    self::assertTrue($this->access()->manage($this->workspace, $this->lead)->isAllowed());
    self::assertFalse($this->access()->manage($this->workspace, $this->member)->isAllowed());
  }

  /**
   * A service account bound to another workspace is never manageable here.
   */
  public function testManageDeniedForForeignWorkspaceServiceAccount(): void {
    $foreignTeam = $this->container->get('entity_type.manager')->getStorage('bb_team')->create([
      'name' => 'Other team',
      'workspace_id' => $this->foreignWorkspace->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $foreignTeam);
    $foreignTeam->save();

    $expires = $this->container->get('datetime.time')->getCurrentTime() + 86400 * 10;
    $foreignLead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $foreignLead);
    $foreignLeadRole = OgRole::load('bb_workspace-bb_workspace-lead');
    self::assertInstanceOf(OgRole::class, $foreignLeadRole);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($foreignLead)
      ->setGroup($this->foreignWorkspace)
      ->setRoles([$foreignLeadRole])
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $foreignAccount = $this->manager()->create($this->foreignWorkspace, $foreignTeam, 'foreign-bot', 'guest', 'reporter', date('Y-m-d', $expires), $foreignLead)['user'];

    // The acting Lead administers $this->workspace, not the foreign one: the
    // workspace-scoped marker check must deny this even though `$this->lead`
    // genuinely administers SOME workspace.
    self::assertFalse($this->access()->manage($this->workspace, $this->lead, $foreignAccount)->isAllowed());
  }

  /**
   * A consumer belonging to a different service user is never manageable.
   */
  public function testManageDeniedForMismatchedServiceUserConsumer(): void {
    $expires = date('Y-m-d', $this->container->get('datetime.time')->getCurrentTime() + 86400 * 10);
    $one = $this->manager()->create($this->workspace, $this->team, 'bot-one', 'guest', 'reporter', $expires, $this->lead);
    $two = $this->manager()->create($this->workspace, $this->team, 'bot-two', 'guest', 'reporter', $expires, $this->lead);

    // Swapped: account one's consumer checked against account two's row.
    self::assertFalse($this->access()->manage($this->workspace, $this->lead, $two['user'], $one['consumer'])->isAllowed());
    self::assertTrue($this->access()->manage($this->workspace, $this->lead, $one['user'], $one['consumer'])->isAllowed());
  }

  /**
   * A service account's key list is its workspace administrator's to see.
   *
   * The list at /user/{user}/api-keys stays owner-only for people; only the
   * workspace administrator of a service account reaches that account's.
   */
  public function testKeyListOpenToServiceAccountAdministratorOnly(): void {
    $expires = date('Y-m-d', $this->container->get('datetime.time')->getCurrentTime() + 86400 * 10);
    $service = $this->manager()->create($this->workspace, $this->team, 'list-bot', 'guest', 'reporter', $expires, $this->lead, 'GitLab E2E')['user'];
    $access = $this->container->get(ApiKeyAccess::class);
    self::assertInstanceOf(ApiKeyAccess::class, $access);
    $list = fn (UserInterface $user): RouteMatch => new RouteMatch('view.bb_api_keys.page', new Route('/user/{user}/api-keys'), ['user' => $user], ['user' => (string) $user->id()]);

    self::assertTrue($access->keyList($list($service), $this->lead)->isAllowed(), 'the workspace administrator manages the service account\'s keys');
    self::assertFalse($access->keyList($list($service), $this->member)->isAllowed(), 'an ordinary member does not');
    self::assertFalse($access->keyList($list($this->member), $this->lead)->isAllowed(), 'a person\'s keys stay theirs alone');
    self::assertTrue($access->keyList($list($this->member), $this->member)->isAllowed(), 'the owner keeps their own list');
  }

  /**
   * Every Service Accounts route restricts authentication to a cookie session.
   */
  public function testRoutesAcceptOnlyCookieAuthentication(): void {
    $data = Yaml::decode((string) file_get_contents(DRUPAL_ROOT . '/../config/sync/views.view.bb_service_accounts.yml'));
    unset($data['display']['settings']['display_options']['display_extenders']);
    $this->container->get('entity_type.manager')->getStorage('view')->create($data)->save();
    $this->container->get('router.builder')->rebuild();

    $routeProvider = $this->container->get('router.route_provider');
    foreach ([
      'bb_api_key.service_account.add',
      'bb_api_key.service_account.key_add',
      'bb_api_key.service_account.key_revoke',
      'bb_api_key.service_account.disable',
      'view.bb_service_accounts.settings',
    ] as $routeName) {
      $route = $routeProvider->getRouteByName($routeName);
      self::assertSame(
        ['cookie'],
        $route->getOption('_auth'),
        "$routeName must restrict authentication to a cookie session, not a bearer token",
      );
    }
  }

}
