<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Tests\bb_core\Kernel\DanglingReferenceTrait;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityReferenceSelection\SelectionInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\entity\QueryAccess\QueryAccessHandlerInterface;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\Form\WorklogForm;
use Drupal\jsonapi\JsonApiFilter;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Routing\Exception\RouteNotFoundException;

/**
 * Owner, tenant and JSON:API read-only access for Worklog.
 *
 * @SuppressWarnings("PHPMD.TooManyPublicMethods")
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorklogAccessTest extends KernelTestBase {

  use DanglingReferenceTrait;

  use OgScopeFixtureTrait;
  use TeamWorldTrait;
  use UserCreationTrait;
  use BillingAccountFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file',
    'image',
    'system',
    'user',
    'field',
    'options',
    'text',
    'link',
    'filter',
    'datetime',
    'entity',
    'state_machine',
    'og',
    'serialization',
    'jsonapi',
    'island',
    'bb_core',
    'bb_track',
  ];

  /**
   * Account that owns fixture groups so actors are not auto-membered.
   */
  private UserInterface $worldOwner;

  /**
   * Employee A: workspace-A lead who records time.
   */
  private UserInterface $employee;

  /**
   * Employee B: peer lead in workspace A.
   */
  private UserInterface $peer;

  /**
   * Guest in A and lead in B, with no site-wide record permission.
   */
  private UserInterface $guestLead;

  /**
   * Can view projects, holds no workspace membership.
   */
  private UserInterface $projectReader;

  /**
   * Site administrator who does not own the fixture rows.
   */
  private UserInterface $admin;

  /**
   * Workspace A, where A and B record.
   */
  private BbWorkspaceInterface $workspaceA;

  /**
   * Workspace B, where guestLead is lead.
   */
  private BbWorkspaceInterface $workspaceB;

  /**
   * Customer group on project P.
   */
  private BbGroupInterface $groupG1;

  /**
   * Permitted project in workspace A.
   */
  private BbProjectInterface $projectP;

  /**
   * Permitted project in workspace B.
   */
  private BbProjectInterface $projectB;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user',
      'file',
      'og_membership',
      'bb_workspace',
      'bb_group',
      'bb_team',
      'bb_project',
      'bb_ticket',
      'bb_track_submission', 'bb_track_account', 'bb_track_worklog',
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installOgScopeFixture();

    $this->createUser([], 'uid1-dummy');
    $world_owner = $this->createUser([], 'world-owner');
    $employee = $this->createUser([
      'record own worklog',
      'view bb_project',
      'view bb_ticket',
      'view bb_group',
    ], 'employee-a');
    $peer = $this->createUser([
      'record own worklog',
      'view bb_project',
      'view bb_ticket',
      'view bb_group',
    ], 'employee-b');
    $guest_lead = $this->createUser([
      'view bb_project',
      'view bb_ticket',
      'view bb_group',
    ], 'guest-lead');
    $project_reader = $this->createUser(['view bb_project'], 'project-reader');
    $admin = $this->createUser(['administer bakers'], 'fixture-admin');
    self::assertInstanceOf(UserInterface::class, $world_owner);
    self::assertInstanceOf(UserInterface::class, $employee);
    self::assertInstanceOf(UserInterface::class, $peer);
    self::assertInstanceOf(UserInterface::class, $guest_lead);
    self::assertInstanceOf(UserInterface::class, $project_reader);
    self::assertInstanceOf(UserInterface::class, $admin);
    $this->worldOwner = $world_owner;
    $this->employee = $employee;
    $this->peer = $peer;
    $this->guestLead = $guest_lead;
    $this->projectReader = $project_reader;
    $this->admin = $admin;

    $storage = $this->container->get('entity_type.manager');
    $workspace_a = $storage->getStorage('bb_workspace')->create([
      'name' => 'Workspace A',
      'slug' => 'workspace-a',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $workspace_a->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace_a);
    $this->workspaceA = $workspace_a;

    $workspace_b = $storage->getStorage('bb_workspace')->create([
      'name' => 'Workspace B',
      'slug' => 'workspace-b',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $workspace_b->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace_b);
    $this->workspaceB = $workspace_b;

    $this->groupG1 = $this->createGroup('Customer G1', $this->workspaceA);
    $group_b = $this->createGroup('Customer B', $this->workspaceB);
    $this->projectP = $this->createProject('PRJP', $this->groupG1);
    $this->projectB = $this->createProject('PRJB', $group_b);

    $this->addMembership($this->workspaceA, $this->employee, ['lead']);
    $this->addMembership($this->workspaceA, $this->peer, ['lead']);
    $this->addMembership($this->workspaceA, $this->guestLead, ['guest']);
    $this->addMembership($this->workspaceB, $this->guestLead, ['lead']);
  }

  /**
   * The owner may view, update and delete a recorded entry; a peer may not.
   */
  public function testOwnerAndPeerItemAccess(): void {
    $own = $this->createEntry($this->employee, $this->projectP);
    $peer = $this->createEntry($this->peer, $this->projectP);

    self::assertTrue($own->access('view', $this->employee));
    self::assertTrue($own->access('update', $this->employee));
    self::assertTrue($own->access('delete', $this->employee));
    self::assertFalse($own->access('view', $this->peer));
    self::assertFalse($own->access('update', $this->peer));
    self::assertFalse($own->access('delete', $this->peer));
    self::assertFalse($peer->access('view', $this->employee));
    self::assertFalse($own->access('view', $this->admin));
    self::assertFalse($own->access('view', new AnonymousUserSession()));
  }

  /**
   * An approved row stays readable to its owner and refuses mutation.
   */
  public function testApprovedEntryIsReadOnlyForOwner(): void {
    $entry = $this->createEntry($this->employee, $this->projectP, 'approved');
    self::assertTrue($entry->access('view', $this->employee));
    self::assertFalse($entry->access('update', $this->employee));
    self::assertFalse($entry->access('delete', $this->employee));
  }

  /**
   * Demoting the owner to guest denies update and delete.
   */
  public function testOwnerDemotedToGuestCannotUpdateOrDelete(): void {
    $owner = $this->rankOnlyOwner();
    $entry = $this->createEntry($owner, $this->projectP);
    self::assertTrue($entry->access('update', $owner));
    self::assertTrue($entry->access('delete', $owner));

    $this->addMembership($this->workspaceA, $owner, ['guest']);
    $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_track_worklog')
      ->resetCache();

    self::assertFalse($entry->access('update', $owner));
    self::assertFalse($entry->access('delete', $owner));
    self::assertTrue($entry->access('view', $owner));
  }

  /**
   * An unresolved project still lets the owner correct or delete.
   */
  public function testOwnerCanMutateWhenProjectIsUnresolved(): void {
    $owner = $this->rankOnlyOwner();
    $entry = $this->createEntry($owner, $this->projectP);
    $this->addMembership($this->workspaceA, $owner, ['guest']);
    $this->removeRowsOnly($this->projectP);
    $storage = $this->container->get('entity_type.manager')
      ->getStorage('bb_track_worklog');
    $storage->resetCache([$entry->id()]);
    $reloaded = $storage->load($entry->id());
    self::assertInstanceOf(Worklog::class, $reloaded);
    $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_track_worklog')
      ->resetCache();

    self::assertTrue($reloaded->access('view', $owner));
    self::assertTrue($reloaded->access('update', $owner));
    self::assertTrue($reloaded->access('delete', $owner));
  }

  /**
   * An access-checked collection returns only the caller's own rows.
   */
  public function testAccessCheckedQueryReturnsOwnerRowsOnly(): void {
    $own = $this->createEntry($this->employee, $this->projectP);
    $this->createEntry($this->peer, $this->projectP);

    self::assertSame([(int) $own->id()], $this->queryAs($this->employee));
    self::assertNotContains((int) $own->id(), $this->queryAs($this->peer));
    self::assertSame([], $this->queryAs($this->admin));
    self::assertSame([], $this->queryAs($this->projectReader));
    self::assertSame([], $this->queryAs(new AnonymousUserSession()));
  }

  /**
   * Guest-in-A/lead-in-B cannot pick A's project and can write against B.
   */
  public function testGuestWorkspaceDeniedAndLeadWorkspaceAllowed(): void {
    $this->container->get('current_user')->setAccount($this->guestLead);
    $denied = $this->submitAdd($this->projectP);
    self::assertArrayHasKey('project', $denied->getErrors());
    self::assertSame([], $this->queryAs($this->guestLead));

    $allowed = $this->submitAdd($this->projectB);
    self::assertSame([], $allowed->getErrors());
    $ids = $this->queryAs($this->guestLead);
    self::assertCount(1, $ids);
    $entry = Worklog::load(reset($ids));
    self::assertInstanceOf(Worklog::class, $entry);
    self::assertSame((int) $this->guestLead->id(), (int) $entry->get('owner_user_id')->target_id);
    self::assertFalse($entry->access('view', $this->employee));
  }

  /**
   * Project picker omits workspaces where the actor cannot record.
   */
  public function testProjectSelectionOmitsProjectsWithoutRecordRank(): void {
    $this->container->get('current_user')->setAccount($this->guestLead);
    $handler = $this->container->get('plugin.manager.entity_reference_selection')
      ->getInstance([
        'target_type' => 'bb_project',
        'handler' => 'bb_track_work_project',
      ]);
    self::assertInstanceOf(SelectionInterface::class, $handler);
    $ids = array_map('intval', array_keys($handler->getReferenceableEntities()['bb_project'] ?? []));
    self::assertNotContains((int) $this->projectP->id(), $ids);
    self::assertContains((int) $this->projectB->id(), $ids);
  }

  /**
   * Guest-in-A/lead-in-B can open the user add route.
   */
  public function testGuestLeadCanOpenAddRoute(): void {
    $this->container->get('router.builder')->rebuild();
    $result = $this->container->get('access_manager')->checkNamedRoute(
      'bb_track.worklog.add',
      [],
      $this->guestLead,
      TRUE,
    );
    self::assertTrue($result->isAllowed());
  }

  /**
   * A workspace-less project reader cannot write or list worklog.
   */
  public function testWorkspaceLessProjectReaderDenied(): void {
    $this->createEntry($this->employee, $this->projectP);
    self::assertFalse($this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_track_worklog')
      ->createAccess(NULL, $this->projectReader));
    $this->container->get('current_user')->setAccount($this->projectReader);
    $form_state = $this->submitAdd($this->projectP);
    self::assertArrayHasKey('project', $form_state->getErrors());
    self::assertSame([], $this->queryAs($this->projectReader));
  }

  /**
   * Entity validation does not apply the form project picker.
   */
  public function testValidateAcceptsProjectWithoutFormSelectionHandler(): void {
    $this->container->get('current_user')->setAccount($this->admin);
    $entry = Worklog::create([
      'owner_user_id' => $this->employee->id(),
      'work_date' => '2026-10-06',
      'timezone' => 'UTC',
      'duration_seconds' => 3600,
      'description' => 'Imported row',
      'derivation' => 'manual',
      'state' => 'recorded',
      'project_id' => $this->projectP->id(),
    ]);
    $violations = $entry->validate();
    foreach ($violations as $violation) {
      self::assertStringStartsNotWith('project_id', $violation->getPropertyPath());
    }
  }

  /**
   * Owner history remains readable after the linked project is deleted.
   */
  public function testOwnerCanViewAfterProjectDeleted(): void {
    $entry = $this->createEntry($this->employee, $this->projectP);
    $this->removeRowsOnly($this->projectP);
    $storage = $this->container->get('entity_type.manager')
      ->getStorage('bb_track_worklog');
    $storage->resetCache([$entry->id()]);
    $reloaded = $storage->load($entry->id());
    self::assertInstanceOf(Worklog::class, $reloaded);
    self::assertTrue($reloaded->access('view', $this->employee));
    self::assertSame([(int) $reloaded->id()], $this->queryAs($this->employee));
  }

  /**
   * Query access is owner-scoped and denies anonymous accounts.
   */
  public function testQueryAccessCacheabilityAndAnonymousDeny(): void {
    $handler = $this->container->get('entity_type.manager')
      ->getHandler('bb_track_worklog', 'query_access');
    self::assertInstanceOf(QueryAccessHandlerInterface::class, $handler);

    $owner_conditions = $handler->getConditions('view', $this->employee);
    self::assertFalse($owner_conditions->isAlwaysFalse());
    self::assertContains('user', $owner_conditions->getCacheContexts());

    $anon = $handler->getConditions('view', new AnonymousUserSession());
    self::assertTrue($anon->isAlwaysFalse());

    $reader = $handler->getConditions('view', $this->projectReader);
    self::assertFalse($reader->isAlwaysFalse());
  }

  /**
   * Filtered JSON:API reads receive AMONG_ALL when the query is not empty.
   */
  public function testJsonApiFilterAccessFollowsQueryAccess(): void {
    self::assertTrue($this->filterAccess($this->employee)->isAllowed());
    self::assertTrue($this->filterAccess($this->projectReader)->isAllowed());
    self::assertFalse($this->filterAccess(new AnonymousUserSession())->isAllowed());
  }

  /**
   * JSON:API exposes GET collection and item routes and drops writes.
   */
  public function testJsonApiRoutesAreReadOnly(): void {
    $this->container->get('router.builder')->rebuild();
    $provider = $this->container->get('router.route_provider');
    $prefix = 'jsonapi.bb_track_worklog--bb_track_worklog.';

    $collection = $provider->getRouteByName($prefix . 'collection');
    self::assertContains('GET', $collection->getMethods());
    self::assertNotContains('POST', $collection->getMethods());
    $individual = $provider->getRouteByName($prefix . 'individual');
    self::assertContains('GET', $individual->getMethods());
    self::assertNotContains('PATCH', $individual->getMethods());
    self::assertNotContains('DELETE', $individual->getMethods());

    $project_related = $provider->getRouteByName($prefix . 'project_id.related');
    self::assertContains('GET', $project_related->getMethods());
    self::assertNotContains('POST', $project_related->getMethods());

    foreach ([
      $prefix . 'collection.post',
      $prefix . 'individual.patch',
      $prefix . 'individual.delete',
      $prefix . 'owner_user_id.related',
      $prefix . 'owner_user_id.relationship.get',
      $prefix . 'workspace_id.related',
      $prefix . 'workspace_id.relationship.get',
      $prefix . 'project_id.relationship.post',
      $prefix . 'ticket_id.relationship.post',
    ] as $name) {
      try {
        $provider->getRouteByName($name);
        self::fail("Route $name must be absent.");
      }
      catch (RouteNotFoundException) {
      }
    }
  }

  /**
   * Item access carries user cacheability.
   */
  public function testItemAccessCacheability(): void {
    $entry = $this->createEntry($this->employee, $this->projectP);
    $result = $entry->access('view', $this->employee, TRUE);
    self::assertInstanceOf(AccessResult::class, $result);
    self::assertTrue($result->isAllowed());
    self::assertContains('user', $result->getCacheContexts());
  }

  /**
   * A team lead's query reads team rows of the team workspace only.
   */
  public function testLeadQueryReadsTeamRowsInTeamWorkspaceOnly(): void {
    $w = $this->createTeamWorld();
    $l_p1 = (int) $this->teamEntry('L', 'P1')->id();
    $m_p1 = (int) $this->teamEntry('M', 'P1')->id();
    $m_p2 = (int) $this->teamEntry('M', 'P2')->id();
    $this->teamEntry('M2', 'P2');
    $this->teamEntry('M', 'P1', ['voided' => TRUE]);
    $mb_p1 = (int) $this->teamEntry('Mb', 'P1')->id();
    $wl_p1 = (int) $this->teamEntry('WL', 'P1')->id();

    $lead = $this->queryAs($w['L']);
    sort($lead);
    self::assertSame([$l_p1, $m_p1, $wl_p1], $lead);
    self::assertNotContains($m_p2, $lead);
    self::assertNotContains($mb_p1, $lead);
    self::assertSame([$m_p1, $m_p2], $this->sorted($this->queryAs($w['M'])));
    self::assertSame([$wl_p1], $this->queryAs($w['WL']));
    self::assertSame([], $this->queryAs(new AnonymousUserSession()));
  }

  /**
   * A lead may view a member's entry but never update or delete it.
   */
  public function testLeadItemViewButNoUpdateOrDelete(): void {
    $w = $this->createTeamWorld();
    $entry = $this->teamEntry('M', 'P1');
    self::assertTrue($entry->access('view', $w['L']));
    self::assertFalse($entry->access('update', $w['L']));
    self::assertFalse($entry->access('delete', $w['L']));
    self::assertFalse($entry->access('view', $w['WL']));
  }

  /**
   * Proposed time is visible and editable only to its owner, never to leads.
   */
  public function testProposedRowsAreOwnerOnly(): void {
    $w = $this->createTeamWorld();
    $proposed = $this->teamEntry('M', 'P1');
    \Drupal::database()->update('bb_track_worklog')->fields(['state' => 'proposed'])
      ->condition('id', $proposed->id())->execute();
    $storage = \Drupal::entityTypeManager()->getStorage('bb_track_worklog');
    $storage->resetCache();
    $proposed = $storage->load($proposed->id());
    $recorded = (int) $this->teamEntry('M', 'P1')->id();
    self::assertTrue($proposed->access('view', $w['M']));
    self::assertTrue($proposed->access('update', $w['M']));
    self::assertTrue($proposed->access('delete', $w['M']));
    foreach ([$w['L'], $w['M2'], $w['WL'], new AnonymousUserSession()] as $other) {
      self::assertFalse($proposed->access('view', $other));
    }
    self::assertSame([$recorded], array_map('intval', array_values($this->queryAs($w['L']))));
    self::assertContains((int) $proposed->id(), array_map('intval', $this->queryAs($w['M'])));
  }

  /**
   * Edit and delete routes belong to the owner even when view widens.
   */
  public function testEditAndDeleteRoutesRequireOwnership(): void {
    $w = $this->createTeamWorld();
    $this->container->get('router.builder')->rebuild();
    $entry = $this->teamEntry('M', 'P1');
    $manager = $this->container->get('access_manager');
    foreach (['bb_track.worklog.edit', 'bb_track.worklog.delete'] as $route) {
      $parameters = ['bb_track_worklog' => $entry->uuid()];
      self::assertFalse($manager->checkNamedRoute($route, $parameters, $w['L']), "$route as lead");
      self::assertTrue($manager->checkNamedRoute($route, $parameters, $w['M']), "$route as owner");
    }
  }

  /**
   * Widened query access carries membership and project cacheability.
   */
  public function testTeamQueryAccessCacheability(): void {
    $w = $this->createTeamWorld();
    $handler = $this->container->get('entity_type.manager')
      ->getHandler('bb_track_worklog', 'query_access');
    self::assertInstanceOf(QueryAccessHandlerInterface::class, $handler);
    $conditions = $handler->getConditions('view', $w['L']);
    self::assertContains('user', $conditions->getCacheContexts());
    self::assertContains('og_membership_list', $conditions->getCacheTags());
    self::assertContains('bb_project_list', $conditions->getCacheTags());
  }

  /**
   * Sorts ids.
   *
   * @param array<int> $ids
   *   Ids.
   *
   * @return array<int>
   *   Sorted ids.
   */
  private function sorted(array $ids): array {
    sort($ids);
    return $ids;
  }

  /**
   * Returns owner-scoped JSON:API filter access for Worklog.
   */
  private function filterAccess(AccountInterface $account): AccessResultInterface {
    $entity_type = $this->container->get('entity_type.manager')
      ->getDefinition('bb_track_worklog');
    $combined = AccessResult::neutral();
    $this->container->get('module_handler')->invokeAllWith(
      'jsonapi_bb_track_worklog_filter_access',
      function (callable $implementation) use (&$combined, $entity_type, $account): void {
        $results = $implementation($entity_type, $account);
        if (is_array($results) && isset($results[JsonApiFilter::AMONG_ALL])) {
          $combined = $combined->orIf($results[JsonApiFilter::AMONG_ALL]);
        }
      },
    );
    $this->container->get('module_handler')->invokeAllWith(
      'jsonapi_entity_filter_access',
      function (callable $implementation, string $module) use (&$combined, $entity_type, $account): void {
        if ($module === 'entity') {
          return;
        }
        $results = $implementation($entity_type, $account);
        if (is_array($results) && isset($results[JsonApiFilter::AMONG_ALL])) {
          $combined = $combined->orIf($results[JsonApiFilter::AMONG_ALL]);
        }
      },
    );
    return $combined;
  }

  /**
   * Runs an access-checked worklog query as the given account.
   *
   * @return array<int>
   *   Matching entity ids.
   */
  private function queryAs(AccountInterface $account): array {
    $this->container->get('account_switcher')->switchTo($account);
    $ids = $this->container->get('entity_type.manager')
      ->getStorage('bb_track_worklog')
      ->getQuery()
      ->accessCheck(TRUE)
      ->execute();
    $this->container->get('account_switcher')->switchBack();
    return array_map('intval', array_values($ids));
  }

  /**
   * An owner whose record permission comes only from workspace rank.
   */
  private function rankOnlyOwner(): UserInterface {
    $owner = $this->createUser([
      'view bb_project',
      'view bb_ticket',
      'view bb_group',
    ], 'rank-only-owner');
    self::assertInstanceOf(UserInterface::class, $owner);
    $this->addMembership($this->workspaceA, $owner, ['lead']);
    return $owner;
  }

  /**
   * Creates a stored worklog row without going through the manager.
   */
  private function createEntry(
    UserInterface $employee,
    BbProjectInterface $project,
    string $state = 'recorded',
  ): Worklog {
    $entry = Worklog::create([
      'owner_user_id' => $employee->id(),
      'work_date' => '2026-10-06',
      'timezone' => 'UTC',
      'duration_seconds' => 3600,
      'description' => 'Recorded work',
      'derivation' => 'manual',
      'state' => $state,
      'project_id' => $project->id(),
    ]);
    LegacyWorklogFixture::save($entry);
    self::assertInstanceOf(Worklog::class, $entry);
    return $entry;
  }

  /**
   * Submits the add form against a project.
   */
  private function submitAdd(BbProjectInterface $project): FormStateInterface {
    $form_state = new FormState();
    $form_state->setValues([
      'work_date' => '2026-10-06',
      'duration' => '1:00',
      'project' => $project->label() . ' (' . $project->id() . ')',
      'description' => 'Scoped write',
      'op' => 'Save',
    ]);
    $this->container->get('form_builder')->submitForm(
      WorklogForm::class,
      $form_state,
    );
    return $form_state;
  }

  /**
   * Creates a group in a workspace.
   */
  private function createGroup(string $name, BbWorkspaceInterface $workspace): BbGroupInterface {
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create([
        'name' => $name,
        'workspace_id' => $workspace->id(),
        'owner_user_id' => $this->worldOwner->id(),
      ]);
    $group->save();
    self::assertInstanceOf(BbGroupInterface::class, $group);
    return $group;
  }

  /**
   * Creates a project in a group.
   */
  private function createProject(string $key, BbGroupInterface $group): BbProjectInterface {
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => $key,
        'key' => $key,
        'owner_user_id' => $this->worldOwner->id(),
        'group_id' => $group->id(),
      ]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->attachBillingAccount($project);
    return $project;
  }

}
