<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Cache\CacheableDependencyInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The rank union is fenced back to the granting group (Layer B, BB-359 D1).
 *
 * Layer A projects the UNION of every rank permission the account holds
 * ANYWHERE into its effective permission set, which is what makes every
 * existing consumer keep working. On its own that union is a hole: an account
 * that is `guest` in workspace A and `lead` in workspace B would carry
 * `update any bb_ticket` globally and could write A's tickets.
 *
 * This test states the invariant that closes it, from both sides — the write
 * that MUST still work and the write that MUST NOT. Asserting only the denial
 * would pass against a fence that denies everything, which is exactly the
 * failure mode a half-written Layer B has.
 *
 * @see \Drupal\bb_core\Access\BbRankAccessPolicy
 * @see \Drupal\bb_core\Access\BbRankEntityFence
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RankEntityAccessTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

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
   * A rank permission does not reach an entity of another workspace.
   *
   * Both halves are asserted against the SAME account in the SAME request, so
   * the difference between them can only be the entity's group.
   */
  public function testRankPermissionDoesNotLeakAcrossWorkspaces(): void {
    $alice = $this->createAccount('alice');
    $this->grantRank($alice, $this->fixture('b', 'bb_workspace'), 'lead');

    // Layer A: the union really is in the effective permission set. Without
    // this the rest of the test would pass for the wrong reason.
    self::assertTrue(
      $alice->hasPermission('update any bb_ticket'),
      'Layer A projects the lead rank of workspace B into the global set',
    );

    self::assertTrue(
      $this->fixture('b', 'bb_ticket')->access('update', $alice),
      'the ticket of the workspace that granted the rank stays writable',
    );
    self::assertFalse(
      $this->fixture('a', 'bb_ticket')->access('update', $alice),
      'the ticket of the workspace that granted nothing does not',
    );
  }

  /**
   * Outside a project's teams, only a workspace lead opens or changes tickets.
   *
   * Entity access agrees with the listings: the ticket is opened, changed and
   * listed exactly where it is in the account's read scope.
   */
  public function testTeamsFenceTicketsByDirectAddress(): void {
    $ticket = $this->fixture('a', 'bb_ticket');
    $facts = [];
    foreach (['guest', 'contributor', 'lead'] as $rank) {
      $outside = $this->createAccount("outside-$rank");
      $this->addMembership($this->fixture('a', 'bb_workspace'), $outside, [$rank]);
      $facts["outside $rank"] = [
        $ticket->access('view', $outside),
        $ticket->access('update', $outside),
        in_array((int) $ticket->id(), $this->queryIdsAs('bb_ticket', $outside), TRUE),
      ];
    }
    $inside = $this->createAccount('inside-contributor');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $inside, ['contributor']);
    $this->addMembership($this->fixture('a', 'bb_team'), $inside, []);
    $facts['inside contributor'] = [
      $ticket->access('view', $inside),
      $ticket->access('update', $inside),
      in_array((int) $ticket->id(), $this->queryIdsAs('bb_ticket', $inside), TRUE),
    ];

    self::assertSame([
      'outside guest' => [FALSE, FALSE, FALSE],
      'outside contributor' => [FALSE, FALSE, FALSE],
      'outside lead' => [TRUE, TRUE, TRUE],
      'inside contributor' => [TRUE, TRUE, TRUE],
    ], $facts);
  }

  /**
   * A change of the project's teams reaches a cached ticket decision.
   *
   * The denial depends on the project, so saving its teams invalidates it,
   * and the next check in the same request lets the new team's member in.
   */
  public function testProjectTeamsChangeReachesTicketAccess(): void {
    $ticket = $this->fixture('a', 'bb_ticket');
    $project = $this->fixture('a', 'bb_project');
    $guest = $this->createAccount('later-team-guest');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $guest, ['guest']);
    $team = $this->createEntity('bb_team', [
      'name' => 'later-team',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
      'owner_user_id' => $project->get('owner_user_id')->target_id,
    ]);
    $this->addMembership($team, $guest, []);

    $denied = $ticket->access('view', $guest, TRUE);
    self::assertFalse($denied->isAllowed());
    self::assertInstanceOf(CacheableDependencyInterface::class, $denied);
    self::assertSame([], array_diff($project->getCacheTags(), $denied->getCacheTags()), 'the decision depends on the project');

    $project->get('teams')->appendItem($team->id());
    $project->save();
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_ticket')->resetCache();
    self::assertTrue($ticket->access('view', $guest), 'the new team lets its member in');
  }

  /**
   * A conductor's owner outside its project's teams still manages it.
   *
   * Teams fence the project's tickets, not the owner's own conductor; such a
   * conductor gets no inbox and registers nothing (ConductorRegistrar).
   */
  public function testOwnerOutsideTheTeamsManagesTheirConductor(): void {
    $owner = $this->createAccount('conductor-owner-outside');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $owner, ['contributor']);
    $conductor = $this->createEntity('bb_conductor', [
      'conductor_id' => 'node-outside',
      'label' => 'node-outside',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'owner_user_id' => $owner->id(),
    ]);
    self::assertTrue($conductor->access('view', $owner));
    self::assertTrue($conductor->access('update', $owner));
    self::assertFalse($this->fixture('a', 'bb_ticket')->access('view', $owner));
  }

  /**
   * Local editors may assign, but cannot borrow a foreign lead's secret access.
   */
  public function testRankFieldGateDoesNotLeakAcrossWorkspaces(): void {
    $alice = $this->createAccount('alice-fields');
    // BB-462 D1 empties the implicit member rank, so a plain membership with
    // no explicit role now grants nothing — an explicit `contributor` role is
    // what makes alice a "local ticket editor" in workspace A.
    $this->addMembership($this->fixture('a', 'bb_workspace'), $alice, ['contributor']);
    $this->addMembership($this->fixture('a', 'bb_team'), $alice, []);
    $this->grantRank($alice, $this->fixture('b', 'bb_workspace'), 'lead');

    // Layer A: the union really does carry the borrowed permission. Without
    // this the denials below could be about the fixture rather than the fence.
    self::assertTrue(
      $alice->hasPermission('edit bb_project'),
      'Layer A projects the lead rank of workspace B into the global set',
    );

    $foreign = $this->fixture('a', 'bb_ticket');
    self::assertTrue(
      $foreign->access('update', $alice),
      'entity access PASSES on the foreign ticket — which is what makes the field gate reachable',
    );

    self::assertTrue(
      $foreign->get('conductor_id')->access('edit', $alice),
      'local ticket editors may assign without any lead rank',
    );
    // env_vars is no longer a sensitive-field gate (BB-454 round 4): the
    // BB-99 dedicated permission check on env_vars / effective_env_vars was
    // retired because the operator decided the field holds no secrets in this
    // product, so viewing it now follows ordinary ticket field access rather
    // than a lead-only check. Note what "ordinary" means precisely, because a
    // looser wording was measured false: core's checkFieldAccess() ALLOWS
    // `view` on an ordinary field unconditionally and never consults entity
    // access, so this assertion is about the absence of a special case, not
    // about `$foreign` having passed entity access above. What bounds a real
    // read is entity access on the way in, exactly as it bounds `title`. See
    // TicketEnvVarsFieldAccessTest, which pins the equality.
    self::assertTrue(
      $foreign->get('env_vars')->access('view', $alice),
      'env_vars now follows ordinary field access, the same as conductor_id above',
    );

    $own = $this->fixture('b', 'bb_ticket');
    self::assertTrue(
      $own->get('conductor_id')->access('edit', $alice),
      'and in the workspace that granted the rank both stay open',
    );
    self::assertTrue(
      $own->get('env_vars')->access('view', $alice),
      'or the fence would simply be denying everything',
    );
  }

  /**
   * An unsaved ticket uses the same scoped edit and secret-view boundaries.
   */
  public function testRankFieldGateDoesNotLeakOnTheCreatePath(): void {
    $alice = $this->createAccount('alice-create');
    // BB-462 D1: no explicit role means no right at all, so alice needs the
    // `contributor` role to be the "local member" the assertions below name.
    $this->addMembership($this->fixture('a', 'bb_workspace'), $alice, ['contributor']);
    $this->grantRank($alice, $this->fixture('b', 'bb_workspace'), 'lead');

    // Layer A: the union really does carry the borrowed permission. Without
    // this the denials below could be about the fixture rather than the fence.
    self::assertTrue(
      $alice->hasPermission('edit bb_project'),
      'Layer A projects the lead rank of workspace B into the global set',
    );

    $foreign = $this->newTicketIn('a');
    self::assertTrue($foreign->isNew(), 'the entity under test is the unsaved one core parses a POST into');
    self::assertTrue(
      $foreign->get('conductor_id')->access('edit', $alice),
      'the local member may create an assigned ticket without borrowing a lead rank',
    );
    // env_vars is no longer a sensitive-field gate (BB-454 round 4, see
    // testRankFieldGateDoesNotLeakAcrossWorkspaces above): with no special case
    // left, core allows `view` on it the way it allows `view` on any ordinary
    // field — unconditionally, without consulting entity access. The membership
    // is what bounds reaching the row at all, not what answers this call.
    self::assertTrue(
      $foreign->get('env_vars')->access('view', $alice),
      'env_vars now follows ordinary field access on the create path too',
    );

    $own = $this->newTicketIn('b');
    self::assertTrue(
      $own->get('conductor_id')->access('edit', $alice),
      'and in the workspace that granted the rank the same POST stays possible',
    );
    self::assertTrue(
      $own->get('env_vars')->access('view', $alice),
      'or the fence would simply be denying every unsaved entity',
    );
  }

  /**
   * The `member` role rides along with every rank but grants nothing (D1).
   *
   * This used to be a characterisation test recording a defect: `member` is a
   * `required` role (Fact 17), so OG puts it on every active membership and
   * `getRoles()` re-adds it even when the row stores nothing, which made
   * `guest` an additive superset of whatever `member` granted — no matter how
   * narrow the spec's D3 table described it.
   *
   * BB-462 D1 fixes this at its root rather than working around it per rank:
   * the implicit `member` role is emptied, so it still rides along with every
   * membership (OG's additive behaviour is unchanged and unfixable per-rank),
   * but riding along now contributes nothing to the permission union. `guest`
   * is therefore a true subset of what an explicit `contributor` role grants,
   * exactly as the spec always intended. `app`, the other rank this test used
   * to cover, is GONE (BB-462 D9): the machine rank is removed entirely.
   */
  public function testTheImplicitMemberRoleRidesAlongButGrantsNothing(): void {
    foreach (['guest'] as $rank) {
      $account = $this->createAccount("holder-of-$rank");
      $this->grantRank($account, $this->fixture('a', 'bb_workspace'), $rank);

      $membership = Og::getMembership(
        $this->fixture('a', 'bb_workspace'),
        $account,
        [OgMembershipInterface::STATE_ACTIVE],
      );
      self::assertNotNull($membership);
      self::assertContains(
        'bb_workspace-bb_workspace-member',
        $membership->getRolesIds(),
        "the implicit member role still rides along with `$rank`",
      );
      self::assertFalse(
        $this->fixture('a', 'bb_ticket')->access('update', $account),
        "but no longer writes tickets for `$rank` — member is emptied (BB-462 D1)",
      );
    }
  }

  /**
   * The fence reads the whole tenancy chain, not just the nearest group.
   *
   * A workspace `lead` holds no bb_project membership at all, so a fence that
   * asked the ticket's project alone would deny every workspace lead. The
   * permission is granted one level up and the entity belongs to both.
   */
  public function testWorkspaceRankReachesEntitiesOfItsProjects(): void {
    $lead = $this->createAccount('workspace-lead');
    $this->grantRank($lead, $this->fixture('b', 'bb_workspace'), 'lead');

    self::assertSame(
      [],
      $this->container->get('og.membership_manager')
        ->getUserGroupIds((int) $lead->id())['bb_project'] ?? [],
      'the actor holds no project membership — the grant is purely workspace level',
    );
    self::assertTrue(
      $this->fixture('b', 'bb_ticket')->access('update', $lead),
      'and still reaches the ticket below it',
    );
  }

  /*
   * testProjectRankDoesNotReachAnotherProject() is GONE (BB-462 D7):
   * bb_project carries no roles of its own any more, so there is no
   * project-granted rank left to test the isolation of.
   */

  /**
   * The group itself is fenced too, not only the content below it.
   *
   * `update any bb_workspace` sits on the lead rank, so without a fence on
   * the group entity a lead of one tenant could rename another.
   */
  public function testWorkspaceLeadCannotEditAnotherWorkspace(): void {
    $lead = $this->createAccount('lead-of-b');
    $this->grantRank($lead, $this->fixture('b', 'bb_workspace'), 'lead');

    self::assertTrue($this->fixture('b', 'bb_workspace')->access('update', $lead));
    self::assertFalse($this->fixture('a', 'bb_workspace')->access('update', $lead));
  }

  /**
   * A term write is fenced to the workspace that owns the term.
   *
   * `bb_term` was the one type deliberately left out of the fence's hop
   * table, on the premise that a term carried no tenant edge at all. That
   * premise is gone: a term now names its workspace and the read scope narrows
   * term collections on it. Query access bounds COLLECTIONS only, so without a
   * hop the individual route stays open — JSON:API loads a term by uuid through
   * EntityRepository::loadEntityByUuid() with `accessCheck(FALSE)` and then
   * asks entity access, which since Layer A reads the un-fenced union.
   *
   * The exposure is a write, not a read: `update any bb_term` sits on the
   * workspace AND project `member` ranks and `delete any bb_term` on both
   * leads, so any member of any workspace could rename or delete every label of
   * every other tenant.
   *
   * Both halves are asserted against the SAME account in the SAME request. A
   * fence that simply denied every term would pass a denial-only test while
   * making labels unmanageable in the workspace that owns them.
   */
  public function testTermWritesAreFencedToTheOwningWorkspace(): void {
    $alice = $this->createAccount('alice-terms');
    $this->grantRank($alice, $this->fixture('a', 'bb_workspace'), 'lead');

    // Layer A: the union really does carry the term writes. Without this the
    // denials below could be about the fixture rather than the fence.
    self::assertTrue(
      $alice->hasPermission('update any bb_term'),
      'Layer A projects the lead rank of workspace A into the global set',
    );
    self::assertTrue(
      $alice->hasPermission('delete any bb_term'),
      'including the delete half, which only the lead ranks carry',
    );

    $own = $this->fixture('a', 'bb_term');
    self::assertTrue(
      $own->access('update', $alice),
      'the label of the workspace that granted the rank stays writable',
    );
    self::assertTrue(
      $own->access('delete', $alice),
      'and deletable',
    );

    $foreign = $this->fixture('b', 'bb_term');
    self::assertFalse(
      $foreign->access('update', $alice),
      'the label of another workspace must not be renamed on a rank held here',
    );
    self::assertFalse(
      $foreign->access('delete', $alice),
      'nor deleted',
    );
  }

  /**
   * The workspace admin's project permissions reach every project (D2, D4).
   *
   * Rewritten for BB-462 D7: `bb_project` is no longer an OG group, so
   * there is no project-granted `lead` rank left to test. Two ranks carry
   * `edit bb_project` and `delete bb_project` — the workspace `lead`/admin
   * rank asserted here, which must reach every project of its own workspace
   * regardless of team membership (D4's admin see-all rule), and the team
   * `lead` rank, which reaches a project only through `bb_project.teams`
   * and is asserted by testTeamLeadReachesTheProjectOfItsTeam() below.
   */
  public function testWorkspaceAdminReachesEveryProjectOfItsWorkspace(): void {
    $workspace_lead = $this->createAccount('ws-lead');
    $this->grantRank($workspace_lead, $this->fixture('b', 'bb_workspace'), 'lead');

    $project = $this->fixture('b', 'bb_project');
    self::assertTrue(
      $project->access('update', $workspace_lead),
      'the workspace admin edits a project of its own workspace',
    );
    self::assertTrue(
      $project->access('delete', $workspace_lead),
      'and can delete it — `delete bb_project` is on its rank',
    );
  }

  /**
   * That project path does not widen to another workspace's projects.
   *
   * The mirror of the test above, and the reason it cannot simply grant on any
   * rank the account holds: D11 exists because a lead of one tenant must not
   * satisfy the alter for another. The chain is walked from the GROUP being
   * asked about, never from the account's memberships in general.
   */
  public function testTheProjectPathDoesNotWidenAcrossWorkspaces(): void {
    $lead = $this->createAccount('lead-of-b');
    $this->grantRank($lead, $this->fixture('b', 'bb_workspace'), 'lead');

    $foreign = $this->fixture('a', 'bb_project');
    self::assertFalse($foreign->access('update', $lead));
    self::assertFalse($foreign->access('delete', $lead));
  }

  /**
   * The team `lead` rank reaches the project of its team (BB-454 round 4).
   *
   * This is the whole point of moving `edit bb_project` / `delete
   * bb_project` off the workspace `contributor` rank and onto the team
   * `lead` rank, and until this test existed nothing said it worked: the
   * permission-level pin in BbRankAccessPolicyTest proves Layer A projects
   * the rank into the effective set, but a project is not the group that
   * granted it. Layer B has to walk `bb_project.teams` back to the granting
   * team (BbRankEntityFence::PROJECT_TEAMS_FIELD, BB-462 D5) for the
   * permission to land on the entity, and a break anywhere in that traversal
   * would leave the permission true and the access FALSE — green everywhere
   * else and the feature dead.
   *
   * Both halves again, for the reason this class states at the top: the grant
   * that must work and the one that must not. The mirror is the sharper of
   * the two here, because a fence that resolved the chain from the ACCOUNT's
   * memberships instead of from the project's own teams would pass the first
   * assertion and leak every project in the instance.
   */
  public function testTeamLeadReachesTheProjectOfItsTeam(): void {
    $team_lead = $this->createAccount('team-lead');
    $this->grantRank($team_lead, $this->fixture('b', 'bb_team'), 'lead');

    // Layer A: the rank really is in the effective set. Without this the
    // assertions below could be about a missing permission rather than about
    // the traversal they exist to prove.
    self::assertTrue(
      $team_lead->hasPermission('edit bb_project'),
      'Layer A projects the team lead rank into the global set',
    );

    $project = $this->fixture('b', 'bb_project');
    self::assertTrue(
      $project->access('update', $team_lead),
      'the team lead edits the project that names its team',
    );
    self::assertTrue(
      $project->access('delete', $team_lead),
      'and can delete it — `delete bb_project` moved onto the same rank',
    );

    $foreign = $this->fixture('a', 'bb_project');
    self::assertFalse(
      $foreign->access('update', $team_lead),
      'a project naming another team is not reachable on this rank',
    );
    self::assertFalse(
      $foreign->access('delete', $team_lead),
      'nor deletable',
    );
  }

  /**
   * The workspace `contributor` rank does not reach a project (BB-454 r4).
   *
   * The other side of the same move, asserted at the ENTITY boundary rather
   * than only at the permission one. Round 3 of this ticket had both
   * permissions on `contributor`; the review found the tree stating the model
   * twice and contradictorily, and the operator moved them to the team lead.
   * This pins the vacated half, so putting them back silently is a red test
   * rather than a config file nobody re-read.
   */
  public function testWorkspaceContributorReachesNoProject(): void {
    $contributor = $this->createAccount('ws-contributor');
    $this->grantRank($contributor, $this->fixture('b', 'bb_workspace'), 'contributor');

    $project = $this->fixture('b', 'bb_project');
    self::assertFalse(
      $project->access('update', $contributor),
      'the workspace contributor rank does not edit a project',
    );
    self::assertFalse(
      $project->access('delete', $contributor),
      'nor delete one',
    );
  }

  /**
   * A site-wide role is not fenced — only the OG union is.
   *
   * The fence exists to bound what Layer A injected. A permission an operator
   * granted on a Drupal role is instance-wide by definition, and narrowing it
   * to a group would silently break every machine account.
   */
  public function testSiteWidePermissionIsNotFenced(): void {
    $operator = $this->createAccount('operator', ['update any bb_ticket', 'view bb_ticket']);

    self::assertTrue($this->fixture('a', 'bb_ticket')->access('update', $operator));
    self::assertTrue($this->fixture('b', 'bb_ticket')->access('update', $operator));
  }

  /**
   * The group owner's rights come from their rank, as the members list shows.
   *
   * With `group_manager_full_access` off, as shipped, ownership grants nothing
   * of its own: the owner reaches content through the lead seat placed on
   * creation, and loses it with that seat.
   */
  public function testTheGroupOwnerHoldsRightsThroughTheRankOnly(): void {
    $this->config('og.settings')->set('group_manager_full_access', FALSE)->save();
    $bob = $this->createAccount('bob');
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'bob-workspace',
      'owner_user_id' => $bob->id(),
    ]);
    $group = $this->createEntity('bb_group', [
      'name' => 'bob-group',
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $project = $this->createEntity('bb_project', [
      'name' => 'bob-project',
      'group_id' => $group->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $ticket = $this->createEntity('bb_ticket', [
      'identifier' => 'T-BOB',
      'title' => 'bob-ticket',
      'workflow' => 'bb_work',
      'project_id' => $project->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);

    self::assertTrue($ticket->access('update', $bob), 'the workspace owner reaches its content');
    self::assertFalse(
      $this->fixture('a', 'bb_ticket')->access('update', $bob),
      'and owning one workspace grants nothing in another',
    );

    $membership = Og::getMembership($workspace, $bob);
    self::assertNotNull($membership);
    $membership->revokeRoleById('bb_workspace-bb_workspace-lead')->save();
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_ticket')->resetCache();
    self::assertFalse($ticket->access('update', $bob), 'a demoted owner keeps no rights');
  }

  /**
   * Builds an UNSAVED ticket anchored in one side's project.
   *
   * Deliberately not saved: this is the shape core hands to the field access
   * check during a JSON:API POST, an entity with a resolvable anchor and no id
   * of its own.
   *
   * @param string $side
   *   Either 'a' or 'b'.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The unsaved ticket.
   */
  private function newTicketIn(string $side): ContentEntityInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'identifier' => 'T-NEW-' . strtoupper($side),
        'title' => "new-ticket-$side",
        'workflow' => 'bb_work',
        'project_id' => $this->fixture($side, 'bb_project')->id(),
        'conductor_id' => $this->fixture($side, 'bb_conductor')->id(),
      ]);
    self::assertInstanceOf(ContentEntityInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Places an account in a rank of a group.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to place.
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group entity.
   * @param string $rank
   *   The rank suffix, e.g. `lead`.
   */
  private function grantRank(AccountInterface $account, ContentEntityInterface $group, string $rank): void {
    $group_type = $group->getEntityTypeId();
    $role = OgRole::load("$group_type-$group_type-$rank");
    self::assertNotNull($role, "the $group_type `$rank` rank is shipped");

    $membership = Og::getMembership($group, $account, OgMembershipInterface::ALL_STATES)
      ?? Og::createMembership($group, $account);
    if (!in_array($role->id(), $membership->getRolesIds(), TRUE)) {
      $membership->addRole($role)->save();
    }
  }

}
