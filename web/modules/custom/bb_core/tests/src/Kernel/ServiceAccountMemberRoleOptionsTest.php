<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\EntityStorageException;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Members\MemberItemBuilder;
use Drupal\og\Entity\OgMembership;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The Members surface offers a service account only allowed roles.
 *
 * The hard security boundary is `ServiceAccountHooks`' presave guard
 * (`ServiceAccountIdentityTest`); this covers the UI-side companion the
 * plan also requires — a service-account row must not even be OFFERED a
 * role the guard would reject, so an operator never hits a silent
 * rejection.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ServiceAccountMemberRoleOptionsTest extends KernelTestBase {

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
    $this->installConfig(['system', 'user', 'og', 'bb_core', 'bb_api_key']);
    Og::addGroup('bb_workspace', 'bb_workspace');
    Og::addGroup('bb_team', 'bb_team');
  }

  /**
   * A service account's workspace row offers only Guest and Contributor.
   */
  public function testServiceAccountWorkspaceRowOffersOnlyGuestAndContributor(): void {
    $entityTypeManager = $this->container->get('entity_type.manager');
    $workspace = $entityTypeManager->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    $this->setCurrentUser($this->leadOf($workspace));

    $service = User::create([
      'name' => 'service-ci-aaaaaaaa',
      'status' => 1,
      'bb_service_workspace' => $workspace->id(),
    ]);
    self::assertInstanceOf(UserInterface::class, $service);
    $service->save();

    $membership = OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($service)
      ->setGroup($workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE);
    $membership->save();

    $builder = new MemberItemBuilder(
      $this->container->get('bb_core.date'),
      $this->container->get('string_translation'),
      $this->container->get('module_handler'),
    );
    $result = $builder->items([$membership], $workspace, TRUE, FALSE);
    $roleControl = $result['controls'][0]['role'];
    $values = array_column($roleControl['#slots']['options']['#props']['options'], 'value');
    sort($values);
    self::assertSame(['contributor', 'guest'], $values);
  }

  /**
   * A human member's workspace row is unaffected and keeps every role.
   */
  public function testHumanWorkspaceRowKeepsEveryRole(): void {
    $entityTypeManager = $this->container->get('entity_type.manager');
    $workspace = $entityTypeManager->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();

    $human = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $human);

    $membership = OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($human)
      ->setGroup($workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE);
    $membership->save();

    $builder = new MemberItemBuilder(
      $this->container->get('bb_core.date'),
      $this->container->get('string_translation'),
      $this->container->get('module_handler'),
    );
    $result = $builder->items([$membership], $workspace, TRUE, FALSE);
    $roleControl = $result['controls'][0]['role'];
    $values = array_column($roleControl['#slots']['options']['#props']['options'], 'value');
    sort($values);
    self::assertContains('lead', $values);
    self::assertContains('guest', $values);
    self::assertContains('contributor', $values);
  }

  /**
   * A service account's team row offers only Member and Reporter.
   */
  public function testServiceAccountTeamRowOffersOnlyMemberAndReporter(): void {
    $entityTypeManager = $this->container->get('entity_type.manager');
    $workspace = $entityTypeManager->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    $team = $entityTypeManager->getStorage('bb_team')->create([
      'name' => 'API home',
      'workspace_id' => $workspace->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    $this->setCurrentUser($this->leadOf($workspace));

    $service = User::create([
      'name' => 'service-ci-bbbbbbbb',
      'status' => 1,
      'bb_service_workspace' => $workspace->id(),
    ]);
    self::assertInstanceOf(UserInterface::class, $service);
    $service->save();

    $membership = OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($service)
      ->setGroup($team)
      ->setState(OgMembershipInterface::STATE_ACTIVE);
    $membership->save();

    $builder = new MemberItemBuilder(
      $this->container->get('bb_core.date'),
      $this->container->get('string_translation'),
      $this->container->get('module_handler'),
    );
    $result = $builder->items([$membership], $team, TRUE, FALSE);
    $roleControl = $result['controls'][0]['role'];
    $values = array_column($roleControl['#slots']['options']['#props']['options'], 'value');
    sort($values);
    self::assertSame(['member', 'reporter'], $values);
  }

  /**
   * Without workspace administration a service account's team rank is fixed.
   *
   * A team owner may write the team's crew, but only the account's workspace
   * administrator may change its rank: the picker offers the current rank
   * alone, and a submitted Reporter is not written.
   */
  public function testTeamRankIsFixedWithoutWorkspaceAdministration(): void {
    [$workspace, $team] = $this->workspaceWithTeam();
    $this->setCurrentUser($this->leadOf($workspace));
    $service = $this->serviceAccount($workspace, 'service-ci-cccccccc');
    $this->container->get('bb_core.membership_writer')->add($team, $service->id());

    $this->setCurrentUser($this->teamOwnerOf($workspace, $team));
    $membership = Og::getMembership($team, $service);
    self::assertInstanceOf(OgMembershipInterface::class, $membership);
    $roles = $this->builder()->rowRoles($membership, MemberItemBuilder::assignableRoles($team), $team);
    self::assertSame(['member'], array_keys($roles));

    $this->container->get('bb_core.membership_writer')->writeRole($team, (int) $service->id(), 'reporter', $roles);
    $reloaded = Og::getMembership($team, $service);
    self::assertInstanceOf(OgMembershipInterface::class, $reloaded);
    self::assertNotContains('bb_team-bb_team-reporter', $reloaded->getRolesIds());

    $reporter = OgRole::load('bb_team-bb_team-reporter');
    self::assertInstanceOf(OgRole::class, $reporter);
    $this->expectException(EntityStorageException::class);
    $reloaded->addRole($reporter)->save();
  }

  /**
   * Only the workspace administrator may add a service account to a team.
   *
   * The team owner holds the team's crew access but not the workspace's, so
   * the add is rejected at save, however the write is reached.
   */
  public function testTeamOwnerCannotAddServiceAccountToTeam(): void {
    [$workspace, $team] = $this->workspaceWithTeam();
    $lead = $this->leadOf($workspace);
    $service = $this->serviceAccount($workspace, 'service-ci-ffffffff');
    $writer = $this->container->get('bb_core.membership_writer');

    $this->setCurrentUser($this->teamOwnerOf($workspace, $team));
    $thrown = NULL;
    try {
      $writer->add($team, $service->id());
    }
    catch (EntityStorageException $error) {
      $thrown = $error;
    }
    self::assertNotNull($thrown, 'a team owner must not add a service account');
    self::assertNull(Og::getMembership($team, $service, OgMembershipInterface::ALL_STATES));

    $this->setCurrentUser($lead);
    $writer->add($team, $service->id());
    self::assertInstanceOf(OgMembershipInterface::class, Og::getMembership($team, $service));
  }

  /**
   * The owner sees a transfer control on a human row, never a service row.
   */
  public function testServiceAccountRowOffersNoOwnershipTransfer(): void {
    [$workspace] = $this->workspaceWithTeam();
    $lead = $this->leadOf($workspace);
    $workspace->set('owner_user_id', $lead->id())->save();
    $this->setCurrentUser($lead);

    $human = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $human);
    $service = $this->serviceAccount($workspace, 'service-ci-dddddddd');
    $memberships = [];
    foreach ([$human, $service] as $account) {
      $membership = OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
        ->setOwner($account)
        ->setGroup($workspace)
        ->setState(OgMembershipInterface::STATE_ACTIVE);
      $membership->save();
      $memberships[] = $membership;
    }

    $controls = $this->builder()->items($memberships, $workspace, TRUE, TRUE)['controls'];
    self::assertArrayHasKey('transfer', $controls[0], 'a human member remains a transfer target');
    self::assertArrayNotHasKey('transfer', $controls[1]);
  }

  /**
   * Ownership never moves to a service account, however the write is reached.
   */
  public function testOwnershipCannotMoveToServiceAccount(): void {
    [$workspace, $team] = $this->workspaceWithTeam();
    $lead = $this->leadOf($workspace);
    $workspace->set('owner_user_id', $lead->id())->save();
    $service = $this->serviceAccount($workspace, 'service-ci-eeeeeeee');
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($service)
      ->setGroup($workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $thrown = NULL;
    try {
      $this->container->get('bb_core.ownership_transfer')->transfer($workspace, (int) $service->id(), MemberItemBuilder::assignableRoles($workspace), 'lead');
    }
    catch (EntityStorageException $error) {
      $thrown = $error;
    }
    self::assertNotNull($thrown, 'the workspace transfer must be rejected');

    $this->expectException(EntityStorageException::class);
    $team->set('owner_user_id', $service->id())->save();
  }

  /**
   * A workspace with one team inside it.
   *
   * @return array{0: \Drupal\bb_core\Entity\BbWorkspaceInterface, 1: \Drupal\bb_core\Entity\BbTeamInterface}
   *   The workspace and the team.
   */
  private function workspaceWithTeam(): array {
    $entityTypeManager = $this->container->get('entity_type.manager');
    $workspace = $entityTypeManager->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    $team = $entityTypeManager->getStorage('bb_team')->create([
      'name' => 'API home',
      'workspace_id' => $workspace->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    return [$workspace, $team];
  }

  /**
   * A new account holding the workspace's Lead rank.
   */
  private function leadOf(BbWorkspaceInterface $workspace): UserInterface {
    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $role = OgRole::load('bb_workspace-bb_workspace-lead');
    self::assertInstanceOf(OgRole::class, $role);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($lead)
      ->setGroup($workspace)
      ->setRoles([$role])
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    return $lead;
  }

  /**
   * A workspace Contributor owning the team, without workspace administration.
   */
  private function teamOwnerOf(BbWorkspaceInterface $workspace, BbTeamInterface $team): UserInterface {
    $owner = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $owner);
    $role = OgRole::load('bb_workspace-bb_workspace-contributor');
    self::assertInstanceOf(OgRole::class, $role);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($owner)
      ->setGroup($workspace)
      ->setRoles([$role])
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    $team->set('owner_user_id', $owner->id())->save();
    self::assertFalse($workspace->access('update', $owner));
    return $owner;
  }

  /**
   * A service account bound to the workspace.
   */
  private function serviceAccount(BbWorkspaceInterface $workspace, string $name): UserInterface {
    $service = User::create(['name' => $name, 'status' => 1, 'bb_service_workspace' => $workspace->id()]);
    $service->save();
    return $service;
  }

  /**
   * The builder under test.
   */
  private function builder(): MemberItemBuilder {
    return new MemberItemBuilder(
      $this->container->get('bb_core.date'),
      $this->container->get('string_translation'),
      $this->container->get('module_handler'),
    );
  }

}
