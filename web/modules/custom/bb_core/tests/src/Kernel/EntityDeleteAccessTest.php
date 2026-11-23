<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\og\OgMembershipInterface;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Who may delete each deletable type, and who may not.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EntityDeleteAccessTest extends KernelTestBase {

  use UserCreationTrait {
    createUser as private;
  }
  use WorkspaceReadScopeTestTrait;

  /**
   * The workspace content any workspace lead deletes.
   */
  private const array WORKSPACE_CONTENT = [
    'bb_ticket', 'bb_team', 'bb_environment',
    'bb_comment', 'bb_ticket_template', 'bb_term', 'bb_invite',
  ];

  /**
   * The types only a site administrator deletes; runs only outside the UI.
   */
  private const array ADMIN_TYPES = ['bb_conductor', 'bb_machine', 'bb_workspace', 'bb_run'];

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
  }

  /**
   * The entity of a type on side 'a', with an invite created on demand.
   */
  private function subject(string $type): ContentEntityInterface {
    if ($type !== 'bb_invite') {
      return $this->fixture('a', $type);
    }
    return $this->createEntity('bb_invite', [
      'email' => 'invitee@example.com',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
    ]);
  }

  /**
   * A lead deletes the workspace's content; a guest and a foreign lead cannot.
   */
  public function testWorkspaceLeadDeletesWorkspaceContent(): void {
    $lead = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $lead, ['lead']);
    $guest = $this->createAccount('guest-a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $guest, ['guest']);
    $foreign = $this->member('b');
    $this->addMembership($this->fixture('b', 'bb_workspace'), $foreign, ['lead']);

    foreach (self::WORKSPACE_CONTENT as $type) {
      $entity = $this->subject($type);
      self::assertTrue($entity->access('delete', $lead), "lead deletes $type");
      self::assertFalse($entity->access('delete', $guest), "guest cannot delete $type");
      self::assertFalse($entity->access('delete', $foreign), "foreign lead cannot delete $type");
    }
    foreach (self::ADMIN_TYPES as $type) {
      self::assertFalse($this->fixture('a', $type)->access('delete', $lead), "lead cannot delete $type");
    }
  }

  /**
   * The owner deletes their workspace; another lead or a member cannot.
   */
  public function testOwnerDeletesOwnWorkspace(): void {
    // As shipped: OG's default would let any owner pass on ownership alone.
    $this->config('og.settings')->set('group_manager_full_access', FALSE)->save();
    $workspace = $this->fixture('a', 'bb_workspace');
    $owner = $this->member('a');
    $this->addMembership($workspace, $owner, ['lead']);
    $workspace->set('owner_user_id', $owner->id())->set('slug', 'workspace-a')->save();
    $lead = $this->createAccount('other-lead-a');
    $this->addMembership($workspace, $lead, ['lead']);
    $member = $this->createAccount('plain-member-a');
    $this->addMembership($workspace, $member, ['member']);
    $foreign = $this->member('b');
    $this->addMembership($this->fixture('b', 'bb_workspace'), $foreign, ['lead']);

    $this->container->get('router.builder')->rebuild();
    // Guards the FALSE cases against a route that does not exist.
    $this->container->get('router.route_provider')->getRouteByName('entity.bb_workspace.delete_form');
    $access_manager = $this->container->get('access_manager');
    $route = fn($account) => $access_manager->checkNamedRoute('entity.bb_workspace.delete_form', ['bb_workspace' => $workspace->get('slug')->value], $account);
    $cases = [
      'owner' => [$owner, TRUE],
      'other lead' => [$lead, FALSE],
      'member' => [$member, FALSE],
      'foreign lead' => [$foreign, FALSE],
    ];
    foreach ($cases as $who => [$account, $expected]) {
      $this->container->get('entity_type.manager')->getAccessControlHandler('bb_workspace')->resetCache();
      self::assertSame($expected, $workspace->access('delete', $account), "$who: entity access");
      self::assertSame($expected, $route($account), "$who: route access");
    }
  }

  /**
   * The creator, the workspace owner, an admin and, for projects, any lead.
   */
  public function testProjectAndGroupDeleteIsTheCreatorsOwnersOrLeads(): void {
    // As shipped: OG's default would let any owner pass on ownership alone.
    $this->config('og.settings')->set('group_manager_full_access', FALSE)->save();
    $workspace = $this->fixture('a', 'bb_workspace');
    $owner = $this->member('a');
    $this->addMembership($workspace, $owner, ['lead']);
    $workspace->set('owner_user_id', $owner->id())->set('slug', 'workspace-a')->save();
    $creator = $this->createAccount('creator-a');
    $this->addMembership($workspace, $creator, ['contributor']);
    $contributor = $this->createAccount('contributor-a');
    $this->addMembership($workspace, $contributor, ['contributor']);
    // Both are in the project's team, so only ownership tells them apart.
    foreach ([$creator, $contributor] as $account) {
      $this->addMembership($this->fixture('a', 'bb_team'), $account, ['member']);
    }
    // In none of the project's teams: the lead rank alone decides.
    $lead = $this->createAccount('other-lead-a');
    $this->addMembership($workspace, $lead, ['lead']);
    $team_lead = $this->createAccount('team-lead-a');
    $this->addMembership($this->fixture('a', 'bb_team'), $team_lead, ['lead']);
    $member = $this->createAccount('plain-member-a');
    $this->addMembership($workspace, $member, ['member']);
    $foreign = $this->member('b');
    $this->addMembership($this->fixture('b', 'bb_workspace'), $foreign, ['lead']);
    $blocked = $this->createAccount('blocked-lead-a');
    $this->addMembership($workspace, $blocked, ['lead'])->setState(OgMembershipInterface::STATE_BLOCKED)->save();
    $this->container->get('cache.static')->deleteAll();
    $admin = $this->createAccount('site-admin', ['administer bakers']);

    $this->container->get('router.builder')->rebuild();
    $cases = [
      'creator contributor' => [$creator, TRUE, TRUE],
      'other contributor' => [$contributor, FALSE, FALSE],
      'non-owner workspace lead' => [$lead, TRUE, FALSE],
      'foreign workspace lead' => [$foreign, FALSE, FALSE],
      'blocked workspace lead' => [$blocked, FALSE, FALSE],
      'team lead' => [$team_lead, FALSE, FALSE],
      'workspace owner' => [$owner, TRUE, TRUE],
      'member' => [$member, FALSE, FALSE],
      'site admin' => [$admin, TRUE, TRUE],
    ];
    foreach (['bb_project' => 1, 'bb_group' => 2] as $type => $column) {
      $entity = $this->fixture('a', $type);
      $entity->set('owner_user_id', $creator->id())->save();
      foreach ($cases as $who => $case) {
        $this->assertDeleteAccess($case[$column], $entity, $case[0], $who);
      }
    }

    // A lead rank in a counts nothing on b, where the account is a contributor.
    $this->addMembership($this->fixture('b', 'bb_workspace'), $lead, ['contributor']);
    $this->addMembership($this->fixture('b', 'bb_team'), $lead, ['member']);
    $this->container->get('cache.static')->deleteAll();
    $foreign_project = $this->fixture('b', 'bb_project');
    $foreign_project->set('owner_user_id', $this->member('b')->id())->save();
    $this->assertDeleteAccess(FALSE, $foreign_project, $lead, 'lead of a, contributor of b');
  }

  /**
   * A lead's project delete keeps the blocking rules and the cascades.
   */
  public function testLeadProjectDeleteKeepsTheDeleteRules(): void {
    $workspace = $this->fixture('a', 'bb_workspace');
    $lead = $this->createAccount('other-lead-a');
    $this->addMembership($workspace, $lead, ['lead']);
    $project = $this->fixture('a', 'bb_project');
    $project->set('owner_user_id', $this->member('a')->id())->save();
    $this->container->get('router.builder')->rebuild();
    $this->setCurrentUser($lead);
    self::assertTrue($project->access('delete', $lead), 'the lead may delete');

    // The world's project-a holds ticket-a.
    $form = $this->container->get('entity.form_builder')->getForm($project, 'delete');
    $sentence = (string) $form['consequences']['blocked']['#slots']['body']['sentence']['#markup'];
    self::assertStringContainsString("can't be deleted: 1 bakers.build ticket still uses it. Remove or reassign it first.", strip_tags($sentence));
    self::assertFalse($form['actions']['submit']['#access'], 'a blocked delete offers no confirm');

    $this->fixture('a', 'bb_ticket')->delete();
    $conductor = $this->createEntity('bb_conductor', ['label' => 'C', 'project_id' => $project->id()]);
    $project->delete();
    foreach (['bb_project' => $project, 'bb_conductor' => $conductor] as $type => $entity) {
      $storage = $this->container->get('entity_type.manager')->getStorage($type);
      $storage->resetCache();
      self::assertNull($storage->load($entity->id()), "$type is gone");
    }
  }

  /**
   * Asserts entity and delete-route access of an account on an entity.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  private function assertDeleteAccess(bool $expected, ContentEntityInterface $entity, AccountInterface $account, string $who): void {
    $type = $entity->getEntityTypeId();
    $url = $entity->toUrl('delete-form');
    $this->container->get('entity_type.manager')->getAccessControlHandler($type)->resetCache();
    self::assertSame($expected, $entity->access('delete', $account), "$who: $type entity access");
    self::assertSame($expected, $this->container->get('access_manager')->checkNamedRoute($url->getRouteName(), $url->getRouteParameters(), $account), "$who: $type route access");
  }

  /**
   * A site administrator deletes the admin entities.
   */
  public function testSiteAdminDeletesAdminEntities(): void {
    $admin = $this->createAccount('site-admin', ['administer bakers']);
    foreach (self::ADMIN_TYPES as $type) {
      self::assertTrue($this->fixture('a', $type)->access('delete', $admin), "admin deletes $type");
    }
  }

}
