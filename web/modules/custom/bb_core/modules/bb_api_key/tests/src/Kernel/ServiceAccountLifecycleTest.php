<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Form\FormState;
use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\Core\Session\SessionManagerInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\bb_api_key\Form\ServiceAccountCreateForm;
use Drupal\bb_api_key\ServiceAccountCleanupException;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgMembership;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Route;

/**
 * Transactional creation, rotation and fail-closed disable.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ServiceAccountLifecycleTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'markdown_easy', 'field', 'state_machine', 'entity', 'og',
    'consumers', 'simple_oauth', 'views', 'island', 'bb_core', 'bb_api_key',
  ];

  /**
   * The workspace a Lead administers.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * A team inside that workspace.
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

    $entityTypeManager = $this->container->get('entity_type.manager');
    $workspace = $entityTypeManager->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    $this->workspace = $workspace;

    $team = $entityTypeManager->getStorage('bb_team')->create([
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
   * The manager under test.
   */
  private function manager(): ServiceAccountManager {
    $manager = $this->container->get(ServiceAccountManager::class);
    self::assertInstanceOf(ServiceAccountManager::class, $manager);
    return $manager;
  }

  /**
   * Successful creation produces exactly one membership per group and a key.
   */
  public function testSuccessfulCreationHasExactlyOneMembershipPerGroupAndOneKey(): void {
    $result = $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->lead);

    self::assertInstanceOf(UserInterface::class, $result['user']);
    self::assertInstanceOf(ConsumerInterface::class, $result['consumer']);
    self::assertNotSame('', $result['secret']);
    self::assertStringStartsWith('service-incident-bot-', $result['user']->getAccountName());

    // `getRolesIds()` also carries OG's implicit, always-prepended `member`
    // rank alongside the one explicit role this creation chose.
    $workspaceMembership = Og::getMembership($this->workspace, $result['user']);
    self::assertInstanceOf(OgMembershipInterface::class, $workspaceMembership);
    self::assertContains('bb_workspace-bb_workspace-guest', $workspaceMembership->getRolesIds());
    self::assertCount(2, $workspaceMembership->getRolesIds(), 'exactly one explicit role, plus the implicit member rank');

    $teamMembership = Og::getMembership($this->team, $result['user']);
    self::assertInstanceOf(OgMembershipInterface::class, $teamMembership);
    self::assertContains('bb_team-bb_team-reporter', $teamMembership->getRolesIds());
    self::assertCount(2, $teamMembership->getRolesIds(), 'exactly one explicit role, plus the implicit member rank');
  }

  /**
   * An invalid workspace role fails closed before any write.
   */
  public function testInvalidWorkspaceRoleCreatesNothing(): void {
    $usersBefore = $this->userCount();

    $this->expectException(\InvalidArgumentException::class);
    try {
      $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'lead', 'reporter', $this->tomorrowPlus(10), $this->lead);
    }
    finally {
      self::assertSame($usersBefore, $this->userCount(), 'an invalid role must create no user at all');
    }
  }

  /**
   * A non-administering actor is denied, and nothing is created.
   */
  public function testWrongActorIsDeniedAndCreatesNothing(): void {
    $usersBefore = $this->userCount();

    $this->expectException(\InvalidArgumentException::class);
    try {
      $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->member);
    }
    finally {
      self::assertSame($usersBefore, $this->userCount());
    }
  }

  /**
   * A team outside the workspace rolls the whole creation back: no orphan user.
   */
  public function testForeignTeamRollsBackTheWholeCreation(): void {
    $entityTypeManager = $this->container->get('entity_type.manager');
    $otherWorkspace = $entityTypeManager->getStorage('bb_workspace')->create(['name' => 'Other', 'slug' => 'other']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $otherWorkspace);
    $otherWorkspace->save();
    $foreignTeam = $entityTypeManager->getStorage('bb_team')->create([
      'name' => 'Foreign',
      'workspace_id' => $otherWorkspace->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $foreignTeam);
    $foreignTeam->save();

    $usersBefore = $this->userCount();
    $consumersBefore = $this->consumerCount();

    $thrown = NULL;
    try {
      $this->manager()->create($this->workspace, $foreignTeam, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->lead);
    }
    catch (\Throwable $error) {
      $thrown = $error;
    }

    self::assertNotNull($thrown, 'joining a foreign team must fail');
    self::assertSame($usersBefore, $this->userCount(), 'the half-created user must be rolled back');
    self::assertSame($consumersBefore, $this->consumerCount(), 'no key may survive a rolled-back creation');
  }

  /**
   * Rotation: a second key authenticates as the same account; both coexist.
   */
  public function testIssueKeyAddsSecondKeyForSameAccount(): void {
    $created = $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->lead);
    $user = $created['user'];

    $second = $this->manager()->issueKey($user, $this->tomorrowPlus(20), $this->lead);

    self::assertNotSame($created['consumer']->id(), $second['consumer']->id());
    self::assertSame((int) $user->id(), (int) $second['consumer']->get('owner_id')->target_id);
    self::assertSame((int) $user->id(), (int) $created['consumer']->get('user_id')->target_id);
  }

  /**
   * Revoking one key deletes it and leaves a sibling key untouched.
   */
  public function testRevokeKeyDeletesOnlyThatKey(): void {
    $created = $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->lead);
    $second = $this->manager()->issueKey($created['user'], $this->tomorrowPlus(20), $this->lead);

    $this->manager()->revokeKey($created['user'], $created['consumer'], $this->lead);

    $storage = $this->container->get('entity_type.manager')->getStorage('consumer');
    self::assertNull($storage->load($created['consumer']->id()));
    self::assertNotNull($storage->load($second['consumer']->id()));
  }

  /**
   * Disable blocks the account, removes its memberships, revokes every key.
   */
  public function testDisableBlocksRemovesMembershipsAndRevokesEveryKey(): void {
    $created = $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->lead);
    $second = $this->manager()->issueKey($created['user'], $this->tomorrowPlus(20), $this->lead);
    $uid = (int) $created['user']->id();

    $this->manager()->disable($created['user'], $this->lead);

    $userStorage = $this->container->get('entity_type.manager')->getStorage('user');
    $userStorage->resetCache([$uid]);
    $reloaded = $userStorage->load($uid);
    self::assertInstanceOf(UserInterface::class, $reloaded);
    self::assertTrue($reloaded->isBlocked());

    self::assertSame(0, $this->membershipCount($uid), 'no workspace or team membership may survive');

    $consumerStorage = $this->container->get('entity_type.manager')->getStorage('consumer');
    self::assertNull($consumerStorage->load($created['consumer']->id()));
    self::assertNull($consumerStorage->load($second['consumer']->id()));
  }

  /**
   * A retry after disable is a safe no-op, never an error or a reactivation.
   */
  public function testDisableIsIdempotent(): void {
    $created = $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->lead);
    $this->manager()->disable($created['user'], $this->lead);

    // MUST NOT THROW, and must not reactivate the account.
    $this->manager()->disable($created['user'], $this->lead);

    $userStorage = $this->container->get('entity_type.manager')->getStorage('user');
    $userStorage->resetCache([$created['user']->id()]);
    $reloaded = $userStorage->load($created['user']->id());
    self::assertInstanceOf(UserInterface::class, $reloaded);
    self::assertTrue($reloaded->isBlocked());
  }

  /**
   * A disabled account is never issued a key.
   */
  public function testDisabledAccountGetsNoKey(): void {
    $created = $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->lead);
    $this->manager()->disable($created['user'], $this->lead);
    $consumersBefore = $this->consumerCount();

    $this->expectException(\InvalidArgumentException::class);
    try {
      $this->manager()->issueKey($created['user'], $this->tomorrowPlus(20), $this->lead);
    }
    finally {
      self::assertSame($consumersBefore, $this->consumerCount());
    }
  }

  /**
   * A failing key save rolls back the user and both memberships.
   */
  public function testKeyFailureRollsBackUserAndMemberships(): void {
    $usersBefore = $this->userCount();
    $membershipsBefore = $this->membershipCount();
    $consumersBefore = $this->consumerCount();

    $thrown = NULL;
    try {
      // The key label is validated only after user and memberships exist.
      $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->lead, str_repeat('k', 256));
    }
    catch (\InvalidArgumentException $error) {
      $thrown = $error;
    }

    self::assertNotNull($thrown);
    self::assertSame($usersBefore, $this->userCount());
    self::assertSame($membershipsBefore, $this->membershipCount());
    self::assertSame($consumersBefore, $this->consumerCount());
  }

  /**
   * A held lock changes nothing and is not reported as a partial disable.
   */
  public function testHeldLockLeavesTheAccountActive(): void {
    $created = $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->lead);
    $lock = $this->createMock(LockBackendInterface::class);
    $lock->method('acquire')->willReturn(FALSE);
    $manager = $this->managerWith($lock, $this->container->get('session_manager'));

    foreach (['disable', 'issueKey'] as $operation) {
      $thrown = NULL;
      try {
        $operation === 'disable'
          ? $manager->disable($created['user'], $this->lead)
          : $manager->issueKey($created['user'], $this->tomorrowPlus(20), $this->lead);
      }
      catch (\RuntimeException $error) {
        $thrown = $error;
      }
      self::assertInstanceOf(\RuntimeException::class, $thrown, $operation);
      self::assertNotInstanceOf(ServiceAccountCleanupException::class, $thrown, $operation);
      self::assertStringContainsString('in progress', $thrown->getMessage());
    }

    self::assertFalse($this->reloadUser((int) $created['user']->id())->isBlocked());
  }

  /**
   * A failed cleanup leaves the account blocked; a retry finishes it.
   */
  public function testCleanupFailureStaysBlockedAndRetryFinishes(): void {
    $created = $this->manager()->create($this->workspace, $this->team, 'incident-bot', 'guest', 'reporter', $this->tomorrowPlus(10), $this->lead);
    $uid = (int) $created['user']->id();
    $calls = 0;
    $sessions = $this->createMock(SessionManagerInterface::class);
    $sessions->method('delete')->willReturnCallback(function () use (&$calls): void {
      if ($calls++ === 0) {
        throw new \RuntimeException('Session store unavailable.');
      }
    });
    $manager = $this->managerWith($this->container->get('lock'), $sessions);

    $thrown = NULL;
    try {
      $manager->disable($created['user'], $this->lead);
    }
    catch (ServiceAccountCleanupException $error) {
      $thrown = $error;
    }
    self::assertNotNull($thrown);
    self::assertTrue($this->reloadUser($uid)->isBlocked());

    $manager->disable($created['user'], $this->lead);

    self::assertSame(2, $calls, 'the retry ran the cleanup again');
    self::assertTrue($this->reloadUser($uid)->isBlocked());
    self::assertSame(0, $this->membershipCount($uid));
    self::assertNull($this->container->get('entity_type.manager')->getStorage('consumer')->load($created['consumer']->id()));
  }

  /**
   * Submitting the same create form twice creates one account only.
   */
  public function testReplayedCreateSubmissionCreatesOneAccount(): void {
    // The form links back to the shipped listing's route.
    $data = Yaml::decode((string) file_get_contents(DRUPAL_ROOT . '/../config/sync/views.view.bb_service_accounts.yml'));
    unset($data['display']['settings']['display_options']['display_extenders']);
    $this->container->get('entity_type.manager')->getStorage('view')->create($data)->save();
    $this->container->get('router.builder')->rebuild();
    $this->setCurrentUser($this->lead);
    $request = Request::create('/_workspace/acme/service-accounts/add', 'POST', ['destination' => '/settings']);
    $request->attributes->add([
      RouteObjectInterface::ROUTE_NAME => 'bb_api_key.service_account.add',
      RouteObjectInterface::ROUTE_OBJECT => new Route('/_workspace/{bb_workspace}/service-accounts/add'),
      'bb_workspace' => $this->workspace,
    ]);
    $request->setSession($this->container->get('request_stack')->getSession());
    $this->container->get('request_stack')->push($request);
    $form = ServiceAccountCreateForm::create($this->container);
    $built = $form->buildForm([], new FormState());
    $values = [
      'nonce' => $built['nonce']['#value'],
      'label' => 'incident-bot',
      'workspace_role' => 'guest',
      'team_role' => 'reporter',
      'team_id' => $this->team->id(),
      'expires' => $this->tomorrowPlus(10),
      'key_label' => '',
    ];
    $usersBefore = $this->userCount();

    $results = [];
    foreach ([1, 2] as $attempt) {
      $state = (new FormState())->setValues($values);
      $submitted = [];
      $form->submitForm($submitted, $state);
      $results[$attempt] = $state->get('result');
    }

    self::assertSame($usersBefore + 1, $this->userCount());
    self::assertIsArray($results[1]);
    self::assertNull($results[2], 'the replay reveals no second secret');
  }

  /**
   * A manager with the given lock and session manager, else the real services.
   */
  private function managerWith(LockBackendInterface $lock, SessionManagerInterface $sessions): ServiceAccountManager {
    return new ServiceAccountManager(
      $this->container->get('entity_type.manager'),
      $this->container->get('database'),
      $lock,
      $sessions,
      $this->container->get('bb_api_key.manager'),
      $this->container->get('bb_core.membership_writer'),
      $this->container->get('account_switcher'),
    );
  }

  /**
   * The user as currently saved.
   */
  private function reloadUser(int $uid): UserInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('user');
    $storage->resetCache([$uid]);
    $user = $storage->load($uid);
    self::assertInstanceOf(UserInterface::class, $user);
    return $user;
  }

  /**
   * The count of `og_membership` entities, optionally for one account.
   */
  private function membershipCount(?int $uid = NULL): int {
    $query = $this->container->get('entity_type.manager')->getStorage('og_membership')->getQuery()->accessCheck(FALSE);
    if ($uid !== NULL) {
      $query->condition('uid', $uid);
    }
    return (int) $query->count()->execute();
  }

  /**
   * A `Y-m-d` date this many days from "now", for `expiryTimestamp()`.
   */
  private function tomorrowPlus(int $days): string {
    $time = $this->container->get('datetime.time')->getCurrentTime();
    return (new \DateTimeImmutable('@' . $time))
      ->setTimezone(new \DateTimeZone('UTC'))
      ->modify('+' . $days . ' days')
      ->format('Y-m-d');
  }

  /**
   * The current count of `user` entities.
   */
  private function userCount(): int {
    return (int) $this->container->get('entity_type.manager')->getStorage('user')->getQuery()->accessCheck(FALSE)->count()->execute();
  }

  /**
   * The current count of `consumer` entities.
   */
  private function consumerCount(): int {
    return (int) $this->container->get('entity_type.manager')->getStorage('consumer')->getQuery()->accessCheck(FALSE)->count()->execute();
  }

}
