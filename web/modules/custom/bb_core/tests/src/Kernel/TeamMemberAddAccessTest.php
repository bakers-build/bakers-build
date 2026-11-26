<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\GroupMembersForm;
use Drupal\bb_core\Form\TeamMemberAddForm;
use Drupal\bb_core\Form\WorkspaceInviteForm;
use Drupal\island\IslandViewAccessInterface;
use Drupal\og\Entity\OgMembership;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\ParameterBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\Yaml\Yaml;

/**
 * Adding a team member is a WRITE and is gated as one (BB-396 review C1).
 *
 * WHAT WENT WRONG, because it is the reason this class exists rather than a
 * nicety it happens to assert. `GroupMembersForm` — `TeamMemberAddForm` when
 * this was written — created an active
 * `og_membership` and checked nothing at all. The only gate in front of it was
 * the route's, and that route serves the Members TAB — so it is gated on
 * `bb_team.view`, which it must be, because reading the crew is a read. The
 * shipped roles turn that into a privilege escalation rather than a theoretical
 * gap: `og.og_role.bb_workspace-bb_workspace-guest` grants `view bb_team`
 * and nothing that could authorise a write, and only `…-lead` holds
 * `update any bb_team`. So the product's LOWEST-privilege role could add any
 * account to any team.
 *
 * WHY NOT OG'S OWN CREATE ACCESS, which would be the idiomatic answer and was
 * measured before being rejected. `BbOgMembershipAccessControlHandler` widens
 * only `view` and delegates `create` to OG verbatim, and
 * `OgMembershipAccessControlHandler::checkCreateAccess()` asks
 * `administer group` / `add user` / `manage members` OF THE TEAM GROUP. None of
 * the `og.og_role.bb_team-bb_team-*` objects carries any of those three —
 * not even `…-lead`, whose permissions are the statistics-visibility set
 * BB-456 D9 added, not a group-management one — so OG's answer is neutral for
 * every account that is not a site-wide `administer organic groups` holder,
 * and delegating would leave an affordance nobody but uid 1 could use. That is
 * a different defect, not a fix.
 *
 * SO THE GATE IS `update` ON THE TEAM. Whoever may change the team may change
 * its crew. It reuses a permission the product already ships and already
 * assigns, it agrees with BB-359 D3 — `manage members` is a write capability
 * reserved to the `lead` rank — and it leaves `og_membership` access exactly as
 * BB-320 will find it.
 *
 * BOTH HALVES ARE ASSERTED, and the second is the one that matters. A build
 * that renders no affordance is not a gate: the POST is independently
 * reachable, so an account that never sees the field can still submit to it.
 * Test 2 is therefore not a duplicate of test 1 — it is the only one of the two
 * that observes the security property.
 *
 * @see \Drupal\bb_core\Form\GroupMembersForm
 * @see \Drupal\bb_core\Access\BbOgMembershipAccessControlHandler
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TeamMemberAddAccessTest extends KernelTestBase {

  use CreateActionTestTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island',
    'ui_patterns', 'bb_core',
  ];

  /**
   * The workspace the team below belongs to.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The team whose crew every case here tries to change.
   */
  private BbTeamInterface $team;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_team');
    // A workspace member's read scope walks projects and groups.
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installConfig(['system', 'user', 'og']);
    // A recipe registers this in `actions:`, which run AFTER `config:` — the
    // measurement behind the withdrawn D10 generators. A kernel test has no
    // recipe, so it registers the group itself; without it
    // `OgMembership::save()` throws "not an OG group" and the refusal below
    // could not be told apart from a storage failure.
    Og::addGroup('bb_team', 'bb_team');
    // The lead rank sits on the WORKSPACE, so that has to be a group too — the
    // rank branch of the alter walks from the team up to its workspace.
    Og::addGroup('bb_workspace', 'bb_workspace');
    $this->container->get('router.builder')->rebuild();
    // THE FACE IS MADE OF COMPONENTS, so the theme has to be the one the render
    // is performed with — not merely installed. A successful submit is
    // answered with `IslandResponse::rebuildSelf()`, which RENDERS this
    // island, so even a
    // write-path case reaches `bb_theme:list` and the two controls inside it.
    // Without this the submit fails with `Template "bb_theme:option_picker"
    // is not defined`, which is a missing theme rather than a refused write.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();

    // Uid 1 would hold every permission and could not be refused, so the root
    // account is created and then left unused: it exists only so the accounts
    // the cases act as are not uid 1 by accident.
    $this->setUpCurrentUser(['uid' => 1]);

    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;

    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 'Platform Crew', 'workspace_id' => $workspace->id()]);
    $team->save();
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $this->team = $team;
  }

  /**
   * The shipped roles are what makes this a privilege escalation, not a nicety.
   *
   * Read out of the shipped objects rather than restated, so the premise this
   * whole class rests on cannot drift: the day someone grants a write
   * capability to `guest`, this fails and names the file. A test that hardcoded
   * "guest may only view" would keep passing through exactly that change.
   */
  public function testTheShippedRolesSeparateReadingTheCrewFromChangingIt(): void {
    $write = 'update any bb_team';

    // BB-462 D1 empties `member`; the base read rights it used to carry
    // implicitly now sit on the explicit `contributor` role instead.
    foreach (['guest', 'contributor'] as $role) {
      $permissions = $this->shippedWorkspaceRole($role)['permissions'];
      self::assertContains(
        'view bb_team',
        $permissions,
        sprintf('The %s role reads the crew, which is why the route is view-gated.', $role),
      );
      self::assertNotContains(
        $write,
        $permissions,
        sprintf('The %s role must not carry the write this form performs.', $role),
      );
    }

    self::assertContains(
      $write,
      $this->shippedWorkspaceRole('lead')['permissions'],
      'The lead role is the one the affordance is for.',
    );
  }

  /**
   * The lead's permission actually reaches the team, and that is not a given.
   *
   * The mechanism, because nothing else in the tree states it and the gate
   * above is built on it. `bb_team` is registered as an OG group, and
   * `og_entity_access()` FORBIDS every non-view operation OG does not itself
   * allow — core then skips the entity type's own handler entirely, so a
   * granular permission is not merely outvoted, it is never asked.
   * `bb_core_og_user_access_alter()` is what restores the pre-registration
   * answer, and it did so for `edit <type>` only: a name hand-declared in
   * `bb_core.permissions.yml` that exists for `bb_project` alone. So
   * `update any bb_team` — the name `EntityPermissionProvider` generates and
   * the name the shipped `lead` role actually carries — was a DEAD permission:
   * granted in config, refused at runtime, and silent about it.
   *
   * Both directions are asserted. The negative is what keeps the alter from
   * being widened into "any bakers.build permission opens the group".
   */
  public function testUpdateAnyBbTeamReachesTheTeamThroughTheOgForbid(): void {
    $this->actAs(['view bb_team']);
    self::assertFalse(
      $this->team->access('update'),
      'Reading the crew does not carry changing it.',
    );

    $this->actAs(['view bb_team', 'update any bb_team']);
    self::assertTrue(
      $this->team->access('update'),
      'The permission the lead role ships with must actually reach the team.',
    );
  }

  /**
   * THE BRANCH PRODUCTION TAKES: the grant arrives as an OG RANK, not a role.
   *
   * Every other case here hands the permission to the account through a
   * site-wide Drupal role, and `$holds()` in
   * `bb_core_og_user_access_alter()` short-circuits on
   * `hasSiteWidePermission()` before it ever walks a tenancy chain. So those
   * cases exercise the site-wide branch — and the shipped `lead` holds
   * `update any bb_team` as an OG permission ON THE WORKSPACE, which is
   * reached only through the other branch:
   * `BbRankEntityFence::groupsAnchoredBy()` hops `bb_team` to its
   * `workspace_id` and `hasGroupPermission()` answers from the workspace's
   * roles. Break that hop and every other test in this class stays green while
   * the affordance dies for the only role it was built for.
   *
   * The negative is the same boundary from the other side, and it is the one
   * that matters for a widened access alter: a lead of ANOTHER workspace must
   * not reach this team. `$holds()` walks the chain of the GROUP being asked
   * about rather than the account's memberships in general, which is the whole
   * of that distinction.
   */
  public function testTheLeadRankReachesItsOwnWorkspacesTeamAndNoOther(): void {
    $ours = $this->createUser(['view bb_team']);
    $theirs = $this->createUser(['view bb_team']);
    self::assertInstanceOf(UserInterface::class, $ours);
    self::assertInstanceOf(UserInterface::class, $theirs);

    $rival = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Rival', 'slug' => 'rival']);
    $rival->save();

    $this->grantWorkspaceLead($ours, $this->workspace);
    $this->grantWorkspaceLead($theirs, $rival);

    self::assertTrue(
      $this->team->access('update', $ours),
      "A workspace lead reaches its own workspace's team through the rank, not "
      . 'through a site-wide role.',
    );
    self::assertFalse(
      $this->team->access('update', $theirs),
      'A lead of another workspace does not reach this team.',
    );
  }

  /**
   * An account that may only view the team is offered no add affordance.
   *
   * Neither the dialog's route nor the header trigger that opens it.
   */
  public function testAnAccountThatMayOnlyViewTheTeamGetsNoAffordance(): void {
    // In the workspace, so the refusal is the missing write and not the scope.
    $this->joinWorkspace($this->actAs(['view bb_team']));

    self::assertFalse($this->addUrl()->access(), 'The add dialog route refuses an account that may not change the crew.');
    self::assertArrayNotHasKey('#type', $this->headerTrigger(), 'No header trigger renders for it.');
  }

  /**
   * THE SECURITY PROPERTY: the submit itself is refused, not just the field.
   *
   * The POST is reachable without ever rendering the dialog, so this is the
   * assertion that measures the gate: the form re-checks `update` itself.
   */
  public function testTheSubmitIsRefusedForAnAccountThatMayOnlyViewTheTeam(): void {
    $account = $this->actAs(['view bb_team']);

    $this->expectException(AccessDeniedHttpException::class);
    try {
      $this->submitAddForm($account);
    }
    finally {
      self::assertSame(
        0,
        $this->membershipCountFor($account),
        'The refusal happens BEFORE the write, not after it.',
      );
    }
  }

  /**
   * An account that may update the team gets the affordance and the write.
   *
   * The positive half is not decoration: a gate that refuses everyone is the
   * other way of breaking this surface, and it would leave every negative above
   * green.
   */
  public function testAnAccountThatMayUpdateTheTeamCanAddSomeone(): void {
    $account = $this->actAs(['view bb_team', 'update any bb_team']);
    $this->joinWorkspace($account);

    self::assertTrue($this->addUrl()->access(), 'The add dialog route admits a lead.');
    $trigger = $this->headerTrigger();
    self::assertSame('Add member', (string) $trigger['#props']['label']);
    self::assertSame('members-add', (string) $trigger['#props']['attributes']['id']);
    $form = $this->buildAddForm();
    self::assertSame('select', $form['account']['#type'] ?? NULL, 'The add field is a select the chip field reads.');
    self::assertTrue($form['account']['#multiple'] ?? FALSE, 'Several people are added in one submit.');
    self::assertSame('bb_picker_value', $form['role']['#type'] ?? NULL, 'The role is picked in the same dialog.');

    $errors = $this->submitAddForm($account);

    self::assertSame([], $errors, 'The submit reached the write without a validation error.');
    self::assertSame(
      1,
      $this->membershipCountFor($account),
      'Exactly one membership row is created for the added account.',
    );
  }

  /**
   * The dialog writes the chosen role, closes and refreshes the list in place.
   */
  public function testTheDialogAddsWithTheChosenRoleAndClosesInPlace(): void {
    $this->createTeamRole('lead', 'Lead');
    $this->actAs(['view bb_team', 'update any bb_team']);
    $candidate = $this->createUser([], 'candidate');
    self::assertInstanceOf(UserInterface::class, $candidate);
    $this->joinWorkspace($candidate);
    $this->container->get('request_stack')->getCurrentRequest()->query->set('_wrapper_format', 'island_dialog');

    $form_state = $this->submitAddState($candidate, 'lead');

    self::assertSame([], array_map('strval', $form_state->getErrors()));
    $ids = $this->container->get('entity_type.manager')->getStorage('og_membership')->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', 'bb_team')
      ->condition('entity_id', (string) $this->team->id())
      ->condition('uid', (string) $candidate->id())
      ->execute();
    self::assertCount(1, $ids, 'the candidate joined the team');
    $membership = OgMembership::load(reset($ids));
    self::assertInstanceOf(OgMembershipInterface::class, $membership);
    self::assertContains('bb_team-bb_team-lead', $membership->getRolesIds());
    $response = $form_state->getResponse();
    self::assertNotNull($response);
    self::assertSame('delete', $response->headers->get('HX-Reswap'));
    self::assertStringContainsString('bakers.members.changed', (string) $response->headers->get('HX-Trigger'));
    self::assertSame(
      ['Added candidate as Lead.'],
      array_map('strval', $this->container->get('messenger')->messagesByType(WorkspaceInviteForm::RESULT_MESSAGE_TYPE)),
    );
  }

  /**
   * Someone already in the team is refused by name, nothing is written twice.
   */
  public function testSomeoneAlreadyInTheTeamIsRefused(): void {
    $this->actAs(['view bb_team', 'update any bb_team']);
    $crew = $this->createUser([], 'crew');
    self::assertInstanceOf(UserInterface::class, $crew);
    $this->joinWorkspace($crew);
    Og::createMembership($this->team, $crew)->setState(OgMembershipInterface::STATE_ACTIVE)->save();

    $errors = $this->submitAddForm($crew);

    self::assertNotSame([], $errors);
    self::assertSame(1, $this->membershipCountFor($crew));
  }

  /**
   * The Members face has no inline add any more: the header opens the dialog.
   */
  public function testTheMembersFaceHasNoInlineAdd(): void {
    $this->actAs(['view bb_team', 'update any bb_team']);

    $face = $this->container->get('form_builder')->getForm(
      GroupMembersForm::class,
      ['island_id' => 'members', 'host_id' => 'team'],
    );

    self::assertArrayNotHasKey('invite', $face);
    self::assertArrayNotHasKey('account', $face);
    self::assertArrayHasKey('roster', $face);
  }

  /**
   * The members island answers a refresh to whoever may view the team.
   *
   * The same gate as the team's Members tab; a finished dialog asks for the
   * island alone, and that request is resolved from a client-sent id.
   */
  public function testTheMembersIslandRefreshFollowsTheTabGate(): void {
    $host = $this->container->get('island.host_resolver')->resolve('team');
    self::assertInstanceOf(IslandViewAccessInterface::class, $host);

    $viewer = $this->actAs(['view bb_team']);
    self::assertTrue($host->accessIsland('members', $viewer)->isAllowed(), 'a team viewer gets the roster');
    $stranger = $this->actAs([]);
    self::assertFalse($host->accessIsland('members', $stranger)->isAllowed(), 'an account that may not view the team does not');
  }

  /**
   * The picker offers the workspace's people who are not in the team yet.
   */
  public function testTheAddPickerOffersOnlyWorkspaceMembersNotInTheTeam(): void {
    $this->actAs(['view bb_team', 'update any bb_team']);
    $candidate = $this->createUser([], 'candidate');
    $crew = $this->createUser([], 'crew');
    $outsider = $this->createUser([], 'outsider');
    self::assertInstanceOf(UserInterface::class, $candidate);
    self::assertInstanceOf(UserInterface::class, $crew);
    self::assertInstanceOf(UserInterface::class, $outsider);
    $this->joinWorkspace($candidate);
    $this->joinWorkspace($crew);
    Og::createMembership($this->team, $crew)->setState(OgMembershipInterface::STATE_ACTIVE)->save();

    $options = $this->buildAddForm()['account']['#options'] ?? [];

    self::assertArrayHasKey((int) $candidate->id(), $options, 'a workspace member is offered');
    self::assertArrayNotHasKey((int) $crew->id(), $options, 'someone already in the team is not');
    self::assertArrayNotHasKey((int) $outsider->id(), $options, 'someone outside the workspace is not');
  }

  /**
   * A person who is not in the workspace cannot be added to the team.
   */
  public function testSomeoneOutsideTheWorkspaceCannotBeAddedToTheTeam(): void {
    $this->actAs(['view bb_team', 'update any bb_team', 'access user profiles']);
    $outsider = $this->createUser([]);
    self::assertInstanceOf(UserInterface::class, $outsider);

    $errors = $this->submitAddForm($outsider);

    self::assertNotSame([], $errors, 'A person outside the workspace is refused.');
    self::assertSame(
      0,
      $this->membershipCountFor($outsider),
      'No team membership is created for an outsider.',
    );
  }

  /**
   * One submit adds every chosen person with the one chosen role.
   */
  public function testOneSubmitAddsSeveralPeopleWithTheChosenRole(): void {
    $this->createTeamRole('lead', 'Lead');
    $this->actAs(['view bb_team', 'update any bb_team']);
    $ada = $this->createUser([], 'ada');
    $alan = $this->createUser([], 'alan');
    self::assertInstanceOf(UserInterface::class, $ada);
    self::assertInstanceOf(UserInterface::class, $alan);
    $this->joinWorkspace($ada);
    $this->joinWorkspace($alan);

    $form_state = $this->submitAddState([$ada, $alan], 'lead');

    self::assertSame([], array_map('strval', $form_state->getErrors()));
    foreach ([$ada, $alan] as $account) {
      // Queried, not Og::getMembership(): OG caches the account's memberships
      // from before the write.
      $ids = $this->container->get('entity_type.manager')->getStorage('og_membership')->getQuery()
        ->accessCheck(FALSE)
        ->condition('entity_type', 'bb_team')
        ->condition('entity_id', (string) $this->team->id())
        ->condition('uid', (string) $account->id())
        ->execute();
      $membership = OgMembership::load((int) reset($ids));
      self::assertInstanceOf(OgMembershipInterface::class, $membership, sprintf('%s joined the team', $account->getAccountName()));
      self::assertContains('bb_team-bb_team-lead', $membership->getRolesIds());
    }
    self::assertSame(
      ['Added 2 members as Lead.'],
      array_map('strval', $this->container->get('messenger')->messagesByType(WorkspaceInviteForm::RESULT_MESSAGE_TYPE)),
    );
  }

  /**
   * A chosen person already in the team is refused by name; nobody is added.
   */
  public function testSomeoneAlreadyInTheTeamIsRefusedByNameAndNobodyIsAdded(): void {
    $this->actAs(['view bb_team', 'update any bb_team']);
    $ada = $this->createUser([], 'ada');
    $crew = $this->createUser([], 'crew');
    self::assertInstanceOf(UserInterface::class, $ada);
    self::assertInstanceOf(UserInterface::class, $crew);
    $this->joinWorkspace($ada);
    $this->joinWorkspace($crew);
    Og::createMembership($this->team, $crew)->setState(OgMembershipInterface::STATE_ACTIVE)->save();

    $errors = array_map('strval', $this->submitAddState([$ada, $crew])->getErrors());

    self::assertSame(['account' => 'crew is already a member of this team.'], $errors);
    self::assertSame(0, $this->membershipCountFor($ada), 'the valid pick is not added either');
    self::assertSame(1, $this->membershipCountFor($crew));
  }

  /**
   * Becomes the current user, holding exactly the named permissions.
   *
   * @param array<string> $permissions
   *   The permissions the account holds.
   */
  private function actAs(array $permissions): UserInterface {
    $account = $this->createUser($permissions);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);
    $this->enterTeamRoute();
    return $account;
  }

  /**
   * The add dialog's address for this team.
   */
  private function addUrl(): Url {
    return Url::fromRoute('bb_core.bb_team.member_add', ['bb_workspace' => 'acme', 'bb_team' => $this->team->id()]);
  }

  /**
   * The team Members page header's add trigger, as the shell renders it.
   *
   * @return array<string, mixed>
   *   The trigger, or cache metadata alone when it is withheld.
   */
  private function headerTrigger(): array {
    $source = $this->shippedCreateAction('bb_core.bb_team.member_add');
    $value = $source->getPropValue();
    self::assertIsArray($value);
    return $value;
  }

  /**
   * The built add dialog.
   *
   * @return array<string, mixed>
   *   The form array.
   */
  private function buildAddForm(): array {
    $this->enterAddRoute();
    return $this->container->get('form_builder')->getForm(TeamMemberAddForm::class);
  }

  /**
   * Submits the add dialog for one account.
   *
   * @return array<string, string>
   *   The validation errors, so a silent validation failure cannot pass for a
   *   refused write.
   */
  private function submitAddForm(UserInterface $account): array {
    return array_map(
      static fn ($message): string => (string) $message,
      $this->submitAddState($account)->getErrors(),
    );
  }

  /**
   * Submits the add dialog and returns its state.
   *
   * @param \Drupal\user\UserInterface|array<\Drupal\user\UserInterface> $accounts
   *   The person or people chosen.
   * @param string|null $role
   *   The chosen role, or none for the default.
   */
  private function submitAddState(UserInterface|array $accounts, ?string $role = NULL): FormStateInterface {
    $this->enterAddRoute();
    $form_state = new FormState();
    $form_state->setValues(array_filter([
      'account' => array_map(static fn (UserInterface $account): string => (string) $account->id(), is_array($accounts) ? $accounts : [$accounts]),
      'role' => $role,
      'op' => 'Add member',
    ], static fn ($value): bool => $value !== NULL));
    $this->container->get('form_builder')->submitForm(TeamMemberAddForm::class, $form_state);
    return $form_state;
  }

  /**
   * A standard role of the team group type.
   */
  private function createTeamRole(string $name, string $label): void {
    OgRole::create([
      'group_type' => 'bb_team',
      'group_bundle' => 'bb_team',
      'name' => $name,
      'label' => $label,
    ])->save();
  }

  /**
   * Makes the team's add dialog route the current one, keeping the query.
   */
  private function enterAddRoute(): void {
    $current = $this->container->get('request_stack')->getCurrentRequest();
    $this->enterRoute('bb_core.bb_team.member_add', $current?->query->all() ?? []);
  }

  /**
   * Places the account in the team's parent workspace.
   *
   * A team add may only pick a workspace member, so the positive write has
   * to put the person in the workspace first — otherwise it would assert
   * the old leak (any account on the instance).
   */
  private function joinWorkspace(UserInterface $account): void {
    $membership = Og::createMembership($this->workspace, $account);
    $membership->setState(OgMembershipInterface::STATE_ACTIVE);
    $membership->save();
  }

  /**
   * How many memberships of this team the given account holds.
   *
   * Counted per ACCOUNT rather than per team, because registering `bb_team`
   * as an OG group makes OG create the group owner's row on save — so a
   * team-wide count starts at one and a delta assertion would hide which row
   * appeared.
   */
  private function membershipCountFor(UserInterface $account): int {
    $ids = $this->container->get('entity_type.manager')
      ->getStorage('og_membership')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', 'bb_team')
      ->condition('entity_id', (string) $this->team->id())
      ->condition('uid', (string) $account->id())
      ->execute();
    return count($ids);
  }

  /**
   * Makes the team's Members route the current one.
   *
   * The form reads the team off the route match, and `CurrentRouteMatch`
   * answers with a `NullRouteMatch` for anything less than a real request
   * carrying a real route object.
   */
  private function enterTeamRoute(): void {
    $this->enterRoute('bb_core.bb_team.members');
  }

  /**
   * Makes one team route the current one.
   *
   * @param string $route_name
   *   The route.
   * @param array<string, mixed> $query
   *   The request query.
   */
  private function enterRoute(string $route_name, array $query = []): void {
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $request = Request::create('/team-member-add-access-test', 'GET', $query);
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('bb_workspace', $this->workspace);
    $request->attributes->set('bb_team', $this->team);
    $request->attributes->set('_raw_variables', new ParameterBag([
      'bb_workspace' => $this->workspace->getSlug(),
      'bb_team' => (string) $this->team->id(),
    ]));
    $this->container->get('request_stack')->push($request);
  }

  /**
   * One shipped workspace OG role, as `config/sync` holds it.
   *
   * @return array<string, mixed>
   *   The config object's own data.
   */
  private function shippedWorkspaceRole(string $role): array {
    $file = dirname(__DIR__, 7) . sprintf(
      '/config/sync/og.og_role.bb_workspace-bb_workspace-%s.yml',
      $role,
    );
    self::assertFileExists($file, sprintf('The %s workspace role is shipped.', $role));
    $data = Yaml::parseFile($file);
    self::assertIsArray($data);
    self::assertIsArray($data['permissions'] ?? NULL);
    return $data;
  }

  /**
   * Gives an account the `lead` rank of one workspace.
   *
   * Shaped like `RankEntityAccessTest::grantRank()`, so the two read the same:
   * the role is LOADED by its shipped id rather than created here, which is
   * what makes the case fail if the rank stops carrying the permission.
   */
  private function grantWorkspaceLead(UserInterface $account, EntityInterface $workspace): void {
    $role = $this->shippedLeadRank();

    $membership = Og::getMembership($workspace, $account, OgMembershipInterface::ALL_STATES)
      ?? Og::createMembership($workspace, $account);
    if (!in_array($role->id(), $membership->getRolesIds(), TRUE)) {
      $membership->addRole($role)->save();
    }
  }

  /**
   * The shipped workspace `lead` rank, created from its own config file.
   *
   * `Og::addGroup()` creates only the default `member` / `non-member` roles, so
   * the rank this case turns on does not exist in a kernel test until it is
   * imported. Built from `config/install` rather than assembled here, so the
   * PERMISSION LIST is the product's: the day `update any bb_team` leaves
   * that rank, the assertion below fails and names it, instead of the case
   * silently testing a role of its own invention.
   */
  private function shippedLeadRank(): OgRole {
    $id = 'bb_workspace-bb_workspace-lead';
    $role = OgRole::load($id);
    if ($role === NULL) {
      $file = dirname(__DIR__, 3) . '/config/install/og.og_role.' . $id . '.yml';
      self::assertFileExists($file, 'the bb_workspace `lead` rank is shipped');
      $data = Yaml::parseFile($file);
      self::assertIsArray($data);
      unset($data['uuid'], $data['_core']);
      OgRole::create($data)->save();
      $role = OgRole::load($id);
    }
    self::assertInstanceOf(OgRole::class, $role);
    self::assertContains(
      'update any bb_team',
      $role->getPermissions(),
      'The rank this case relies on still carries the permission under test.',
    );
    return $role;
  }

}
