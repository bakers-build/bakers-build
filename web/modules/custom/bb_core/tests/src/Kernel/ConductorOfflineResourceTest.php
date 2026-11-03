<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\consumers\Entity\Consumer;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Resource\ConductorOfflineResource;
use Drupal\KernelTests\KernelTestBase;
use Drupal\simple_oauth\Authentication\TokenAuthUser;
use Drupal\simple_oauth\Authentication\TokenAuthUserInterface;
use Drupal\simple_oauth\Entity\Oauth2Scope;
use Drupal\simple_oauth\Entity\Oauth2TokenInterface;
use Drupal\simple_oauth\Oauth2ScopeInterface;
use Drupal\user\Entity\User;
use Drupal\user\RoleInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Offline POST: owner and instance admin succeed; others are refused.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorOfflineResourceTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'serialization', 'jsonapi', 'jsonapi_resources',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_machine',
      'bb_group', 'bb_project', 'bb_conductor',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user', 'jsonapi']);
    $this->installOgScopeFixture();
    $this->createConductorUser('uid1-dummy');
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'ws-off']);
    $workspace->save();
    $group = $this->container->get('entity_type.manager')->getStorage('bb_group')
      ->create(['name' => 'g-off', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $this->container->get('entity_type.manager')->getStorage('bb_team')
      ->create(['name' => 't-off', 'workspace_id' => $workspace->id()]);
    $team->save();
    $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => 'default-project', 'group_id' => $group->id(), 'teams' => [$team->id()]])->save();
  }

  /**
   * A same-rank peer cannot take another owner's conductor offline.
   */
  public function testPeerOfflineIsDeniedBeforeSave(): void {
    $owner = $this->createConductorUser('off-owner');
    $peer = $this->createConductorUser('off-peer');
    $conductor = $this->onlineConductor($owner, 'mid-peer-off');

    $this->container->get('current_user')->setAccount($peer);
    try {
      ConductorOfflineResource::create($this->container)
        ->process(Request::create('/', 'POST'), $conductor);
      $this->fail('A peer must not take another conductor offline.');
    }
    catch (AccessDeniedHttpException) {
    }

    $fresh = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')->load($conductor->id());
    $this->assertInstanceOf(BbConductorInterface::class, $fresh);
    $this->assertSame('online', $fresh->getStatus());
    $this->assertSame(2, (int) $fresh->get('reported_load')->value);
  }

  /**
   * A foreign account cannot take a conductor offline.
   */
  public function testForeignOfflineIsDeniedBeforeSave(): void {
    $owner = $this->createConductorUser('off-owner-foreign');
    $foreign = $this->createConductorUser('off-foreign');
    $conductor = $this->onlineConductor($owner, 'mid-foreign-off');

    $this->container->get('current_user')->setAccount($foreign);
    try {
      ConductorOfflineResource::create($this->container)
        ->process(Request::create('/', 'POST'), $conductor);
      $this->fail('A foreign account must not take a conductor offline.');
    }
    catch (AccessDeniedHttpException) {
    }

    $fresh = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')->load($conductor->id());
    $this->assertInstanceOf(BbConductorInterface::class, $fresh);
    $this->assertSame('online', $fresh->getStatus());
  }

  /**
   * The owner may take their own conductor offline.
   */
  public function testOwnerOfflineSucceeds(): void {
    $owner = $this->createConductorUser('off-owner-ok');
    $conductor = $this->onlineConductor($owner, 'mid-owner-off');
    $this->container->get('current_user')->setAccount($owner);
    $response = $this->offlineResource()->process(
      Request::create('/', 'POST'),
      $conductor,
    );
    $this->assertSame(200, $response->getStatusCode());
    $fresh = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')->load($conductor->id());
    $this->assertInstanceOf(BbConductorInterface::class, $fresh);
    $this->assertSame('offline', $fresh->getStatus());
    $this->assertSame(0, (int) $fresh->get('reported_load')->value);
  }

  /**
   * An instance admin may take another owner's conductor offline.
   */
  public function testAdminOfflineSucceedsWithoutOwnership(): void {
    $owner = $this->createConductorUser('off-owner-admin');
    $admin = $this->createAdminUser('off-admin');
    $conductor = $this->onlineConductor($owner, 'mid-admin-off');
    $this->assertFalse($conductor->isOwnedBy($admin));
    $this->container->get('current_user')->setAccount($admin);
    $response = $this->offlineResource()->process(
      Request::create('/', 'POST'),
      $conductor,
    );
    $this->assertSame(200, $response->getStatusCode());
    $fresh = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')->load($conductor->id());
    $this->assertInstanceOf(BbConductorInterface::class, $fresh);
    $this->assertSame('offline', $fresh->getStatus());
  }

  /**
   * Update access without ownership or instance-admin is refused.
   *
   * Reaches the ownership branch: access('update') is already true.
   */
  public function testUpdateAccessWithoutOwnershipIsDenied(): void {
    $owner = $this->createConductorUser('off-owner-any');
    $other = $this->createConductorUser('off-any-update');
    $this->grantSiteWide($other, ['update any bb_conductor']);
    $conductor = $this->onlineConductor($owner, 'mid-any-off');
    $this->assertTrue($conductor->access('update', $other));
    $this->assertFalse($conductor->isOwnedBy($other));

    $this->container->get('current_user')->setAccount($other);
    try {
      $this->offlineResource()->process(
        Request::create('/', 'POST'),
        $conductor,
      );
      $this->fail('Update access without ownership must not take a conductor offline.');
    }
    catch (AccessDeniedHttpException) {
    }

    $fresh = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')->load($conductor->id());
    $this->assertInstanceOf(BbConductorInterface::class, $fresh);
    $this->assertSame('online', $fresh->getStatus());
    $this->assertSame(2, (int) $fresh->get('reported_load')->value);
  }

  /**
   * A uid-1 session token cannot take a foreign conductor offline.
   *
   * ConductorOfflineResource injects the current_user proxy. That proxy wraps
   * the TokenAuthUser and does not implement TokenAuthUserInterface, so
   * isInstanceAdmin() must unwrap it or uid 1 inherits the admin bypass.
   */
  public function testUid1SessionTokenOnCurrentUserCannotTakeForeignConductorOffline(): void {
    self::assertTrue(
      $this->container->getParameter('security.enable_super_user'),
      'this case requires Drupal super-user policy on',
    );
    $owner = $this->createConductorUser('off-owner-uid1-token');
    $conductor = $this->onlineConductor($owner, 'mid-uid1-token-off');
    // Reach the ownership / isInstanceAdmin branch: a permission-granularity
    // token's roles are only authenticated, so that role must hold update.
    user_role_grant_permissions(RoleInterface::AUTHENTICATED_ID, ['update any bb_conductor']);
    $tokenUser = $this->uid1SessionTokenAccount();
    $this->container->get('current_user')->setAccount($tokenUser);
    $current = $this->container->get('current_user');
    $this->assertInstanceOf(AccountProxyInterface::class, $current);
    $this->assertFalse($current instanceof TokenAuthUserInterface);
    $this->assertTrue($conductor->access('update', $current));
    $this->assertFalse($conductor->isOwnedBy($current));

    try {
      $this->offlineResource()->process(
        Request::create('/', 'POST'),
        $conductor,
      );
      $this->fail('A uid-1 bb:session token must not take another owner\'s conductor offline.');
    }
    catch (AccessDeniedHttpException) {
    }

    $fresh = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')->load($conductor->id());
    $this->assertInstanceOf(BbConductorInterface::class, $fresh);
    $this->assertSame('online', $fresh->getStatus());
    $this->assertSame(2, (int) $fresh->get('reported_load')->value);
  }

  /**
   * Creates an online conductor with a nonzero reported load.
   */
  private function onlineConductor(UserInterface $owner, string $conductorId): BbConductorInterface {
    return $this->container->get('bb_core.conductor_registrar')->heartbeat($owner, [
      'conductor_id' => $conductorId,
      'host_key' => vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(md5($conductorId), 4)),
      'project' => 'default-project',
      'current_load' => 2,
    ]);
  }

  /**
   * Creates a user allowed to register conductors.
   */
  private function createConductorUser(string $name): UserInterface {
    $role_id = 'conductor_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    user_role_grant_permissions($role_id, ['register bakers conductor']);
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    $this->addContributorEverywhere($user);
    return $user;
  }

  /**
   * Creates an instance-admin account.
   */
  private function createAdminUser(string $name): UserInterface {
    $user = $this->createConductorUser($name);
    $this->grantSiteWide($user, ['administer bakers']);
    return $user;
  }

  /**
   * Grants site-wide permissions through a dedicated role.
   *
   * @param \Drupal\user\UserInterface $account
   *   The user receiving the role.
   * @param array<string> $permissions
   *   Permission names.
   */
  private function grantSiteWide(UserInterface $account, array $permissions): void {
    $role_id = 'offline_' . $account->id();
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    user_role_grant_permissions($role_id, $permissions);
    $account->addRole($role_id);
    $account->save();
  }

  /**
   * A real TokenAuthUser for uid 1 with a permission-granularity session scope.
   *
   * @return \Drupal\simple_oauth\Authentication\TokenAuthUserInterface
   *   The decorated uid-1 session account.
   */
  private function uid1SessionTokenAccount(): TokenAuthUserInterface {
    $this->enableModules(['path_alias', 'consumers', 'simple_oauth']);
    $this->installEntitySchema('consumer');
    $this->installEntitySchema('oauth2_token');
    $this->installConfig(['consumers', 'simple_oauth']);

    $scope = Oauth2Scope::create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'description' => 'Session',
      'grant_types' => [
        'authorization_code' => [
          'status' => TRUE,
          'description' => 'Session',
        ],
      ],
      'umbrella' => FALSE,
      'granularity_id' => Oauth2ScopeInterface::GRANULARITY_PERMISSION,
      'granularity_configuration' => [
        'permission' => 'update any bb_conductor',
      ],
    ]);
    $scope->save();

    $consumer = Consumer::create([
      'client_id' => 'uid1-offline-session',
      'label' => 'uid1 offline session',
      'confidential' => FALSE,
      'grant_types' => ['authorization_code'],
      'scopes' => [$scope->id()],
    ]);
    $consumer->save();

    $super = User::load(1);
    $this->assertInstanceOf(UserInterface::class, $super);
    $token = $this->container->get('entity_type.manager')
      ->getStorage('oauth2_token')
      ->create([
        'bundle' => 'access_token',
        'auth_user_id' => $super->id(),
        'client' => $consumer->id(),
        'scopes' => [$scope->id()],
        'value' => 'uid1-offline-session-token',
        'expire' => time() + 3600,
        'status' => TRUE,
      ]);
    $token->save();
    $this->assertInstanceOf(Oauth2TokenInterface::class, $token);

    return new TokenAuthUser(
      $this->container->get('permission_checker'),
      $token,
      $this->container->get('psr7.http_message_factory'),
      $this->container->get('request_stack'),
    );
  }

  /**
   * A ConductorOfflineResource with jsonapi_resources setter injection.
   */
  private function offlineResource(): ConductorOfflineResource {
    $resource = ConductorOfflineResource::create($this->container);
    $resource->setResourceTypeRepository($this->container->get('jsonapi.resource_type.repository'));
    $resource->setResourceResponseFactory($this->container->get('jsonapi_resources.resource_response_factory'));
    $resource->setDocumentExtractor($this->container->get('jsonapi_resources.document_extractor'));
    $resource->setEntityTypeManager($this->container->get('entity_type.manager'));
    $resource->setEntityAccessChecker($this->container->get('jsonapi_resources.entity_access_checker'));
    return $resource;
  }

}
