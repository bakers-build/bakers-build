<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Whether comment-create is coupled to ticket UPDATE access (BB-466 v2).
 *
 * Handoff v2 widens the ask: the guard on `bb_comment.ticket_id` must not
 * exempt only a dedicated lead rank — it must exempt **whoever may already
 * PATCH the referenced ticket**, with no active run and no conductor
 * required. `SessionScopeConstraintValidator::isExemptByTicketEditRank()`
 * answers that from the RANK the actor holds in the referenced ticket's own
 * project/workspace chain — `update (own|any) bb_ticket` read off the OG
 * membership's own roles — rather than from
 * `$ticket->access('update', $account)`, whose answer a token's umbrella
 * scope can supply with no rank behind it at all (see
 * ::testSiteWideTicketEditWithoutRankIsStillRejected()).
 *
 * `CommentWriteScopeTest::testCommentCreateScopedToParentTicket` is the
 * negative control for this change and is deliberately not touched: its
 * actor holds a session-write-scope role and a team membership with no OG
 * role at all, so it carries no rank-based `update (own|any) bb_ticket`
 * permission anywhere — exactly the "no edit right on the foreign ticket"
 * shape AC 5 requires, not the ownership trap BB-445 warned about.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CommentTicketEditAccessExemptionTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use UserCreationTrait;

  /**
   * The violation the guard raises.
   */
  private const OUT_OF_SCOPE = 'The referenced ticket is outside the active session scope.';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_conductor', 'bb_ticket', 'bb_run', 'bb_comment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    // Uid 1 bypasses every access check, so it must never be an actor.
    $this->createUser();
  }

  /**
   * A workspace lead may comment on a ticket below it with no active run.
   *
   * `lead` carries `update any bb_ticket` (AC 1) — the shipped rank this
   * exemption was originally proposed for is covered as one case of the
   * wider rule, not as a special one.
   */
  public function testLeadWithUpdateAccessMayCommentWithoutActiveRun(): void {
    $lead = $this->createSessionActor('workspace-lead');
    $workspace = $this->createWorkspace('tenant-a');
    $project = $this->createProject('below-a', $workspace);
    $this->addMembership($workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    $ticket = $this->createTicket('GL-466-b', $project);

    $violations = $this->violationMessages($this->buildComment($ticket, $lead));

    self::assertSame([], $violations);
  }

  /**
   * A contributor also carries `update any bb_ticket` and is exempt too.
   *
   * AC 1/AC 2: the coupling is to the capability, not to a name — a second
   * rank that happens to carry the same edit permission is exempt on the
   * same grounds, with no new config of its own. Unlike `lead`, `contributor`
   * is not a workspace "see-all" rank (`BbWorkspaceReadScope::
   * SEE_ALL_WORKSPACE_ROLE_IDS`), so the actor also needs the ordinary team
   * membership that makes the project visible to it at all — the same
   * prerequisite any contributor would need to reference the ticket in the
   * first place, orthogonal to this ticket's guard.
   */
  public function testContributorWithUpdateAccessMayCommentWithoutActiveRun(): void {
    $contributor = $this->createSessionActor('workspace-contributor');
    $workspace = $this->createWorkspace('tenant-f');
    $team = $this->createTeam('below-f-team', $workspace);
    $project = $this->createProject('below-f', $workspace, $team);
    $this->addMembership($workspace, $contributor, ['contributor']);
    $this->addMembership($team, $contributor, []);
    $this->setCurrentUser($contributor);
    $ticket = $this->createTicket('GL-466-f', $project);

    $violations = $this->violationMessages($this->buildComment($ticket, $contributor));

    self::assertSame([], $violations);
  }

  /**
   * A rank with no ticket-update permission is still fenced (AC 4).
   *
   * `member` carries neither `update own bb_ticket` nor
   * `update any bb_ticket` — it may view, not edit — so it keeps hitting
   * the run-derived guard exactly as before.
   */
  public function testMemberWithoutUpdateAccessStillRejectedWithoutActiveRun(): void {
    $member = $this->createSessionActor('non-editing-member');
    $workspace = $this->createWorkspace('tenant-b');
    $project = $this->createProject('below-b', $workspace);
    $this->addMembership($workspace, $member, ['member']);
    $this->setCurrentUser($member);
    $ticket = $this->createTicket('GL-466-c', $project);

    $violations = $this->violationMessages($this->buildComment($ticket, $member));

    self::assertContains(self::OUT_OF_SCOPE, $violations);
  }

  /**
   * A site-wide ticket-edit grant with no rank behind it does NOT exempt.
   *
   * This is the hole an `$ticket->access('update', $account)` reading leaves,
   * and it is the reason the exemption is read off the OG membership instead.
   * `update any bb_ticket` is a child of the `bb:session` umbrella scope,
   * and for a `client_credentials` token
   * `Oauth2AccessPolicy::alterPermissions()` OVERWRITES the calculated
   * permission set with that scope union — after which
   * `BbRankCapability::machineScopeAnswer()` answers the permission
   * site-wide (BB-462 D9) and `BbRankEntityFence` cannot bound it back,
   * because `BbGroupScopedAccount::hasPermission()` consults
   * `hasSiteWidePermission()` first. So every token identity would read as an
   * editor of every ticket in its tenancy and the guard would exempt exactly
   * the machine actor it exists to fence.
   *
   * A Kernel fixture cannot cheaply stand up simple_oauth, a consumer and a
   * real token, so this models the *effect* rather than the mechanism: the
   * permission present site-wide, no rank carrying it in the ticket's chain.
   * That is the state the token produces, and it is the state the exemption
   * must refuse.
   */
  public function testSiteWideTicketEditWithoutRankIsStillRejected(): void {
    $machine = $this->createUser(
      ['write bakers via session scope', 'update any bb_ticket'],
      'flattened-token-identity',
    );
    self::assertInstanceOf(UserInterface::class, $machine);
    $workspace = $this->createWorkspace('tenant-g');
    $project = $this->createProject('below-g', $workspace);
    // A membership carrying no OG role at all: BB-462 D9 deleted the
    // workspace `app` rank, so a machine identity is placed in the tenancy
    // without one and holds nothing by rank.
    $this->addMembership($workspace, $machine, []);
    $this->setCurrentUser($machine);
    $ticket = $this->createTicket('GL-466-g', $project);

    // The flattening is real: the account does hold the permission outright.
    self::assertTrue($machine->hasPermission('update any bb_ticket'));

    $violations = $this->violationMessages($this->buildComment($ticket, $machine));

    self::assertContains(self::OUT_OF_SCOPE, $violations);
  }

  /**
   * An active run still puts the claimed ticket in scope for any rank.
   */
  public function testMemberWithActiveRunIsAccepted(): void {
    $member = $this->createSessionActor('claiming-member');
    $workspace = $this->createWorkspace('tenant-c');
    $project = $this->createProject('below-c', $workspace);
    $this->addMembership($workspace, $member, ['member']);
    $this->setCurrentUser($member);
    $ticket = $this->createTicket('GL-466-d', $project);
    $this->claim($ticket, $member);

    $violations = $this->violationMessages($this->buildComment($ticket, $member));

    self::assertNotContains(self::OUT_OF_SCOPE, $violations);
  }

  /**
   * A lead of one tenancy still may not comment into another one (AC 3).
   */
  public function testLeadOfForeignTenancyIsStillRejected(): void {
    $lead = $this->createSessionActor('foreign-lead');
    $own = $this->createWorkspace('tenant-own');
    $this->addMembership($own, $lead, ['lead']);
    $foreign = $this->createWorkspace('tenant-foreign');
    $foreign_project = $this->createProject('below-foreign', $foreign);
    $this->setCurrentUser($lead);
    $ticket = $this->createTicket('GL-466-e', $foreign_project);

    $violations = $this->violationMessages($this->buildComment($ticket, $lead));

    self::assertNotSame([], $violations);
  }

  /**
   * Creates an account modelling a CLI identity on a `bb:session` token.
   *
   * The site-wide role carries exactly what the umbrella scope puts on every
   * such token; the rank is added by the caller and is what distinguishes the
   * actors.
   */
  private function createSessionActor(string $name): UserInterface {
    $actor = $this->createUser(['write bakers via session scope'], $name);
    self::assertInstanceOf(UserInterface::class, $actor);
    return $actor;
  }

  /**
   * Creates a saved workspace.
   */
  private function createWorkspace(string $slug): ContentEntityInterface {
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')->create(['name' => $slug, 'slug' => $slug]);
    self::assertInstanceOf(ContentEntityInterface::class, $workspace);
    $workspace->save();
    return $workspace;
  }

  /**
   * Creates a saved project, optionally below a workspace via its bb_group.
   */
  private function createProject(string $name, ?ContentEntityInterface $workspace = NULL, ?ContentEntityInterface $team = NULL): ContentEntityInterface {
    $values = ['name' => $name];
    if ($workspace !== NULL) {
      $group = $this->container->get('entity_type.manager')
        ->getStorage('bb_group')
        ->create(['name' => $name . '-group', 'workspace_id' => $workspace->id()]);
      self::assertInstanceOf(ContentEntityInterface::class, $group);
      $group->save();
      $values['group_id'] = $group->id();
    }
    if ($team !== NULL) {
      $values['teams'] = [$team->id()];
    }
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Creates a saved team below the given workspace.
   */
  private function createTeam(string $name, ContentEntityInterface $workspace): ContentEntityInterface {
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')->create(['name' => $name, 'workspace_id' => $workspace->id()]);
    self::assertInstanceOf(ContentEntityInterface::class, $team);
    $team->save();
    return $team;
  }

  /**
   * Creates a saved ticket in the given project.
   */
  private function createTicket(string $identifier, ContentEntityInterface $project): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => $identifier,
        'workflow' => 'bb_work',
        'title' => $identifier,
        'project_id' => $project->id(),
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Opens a running run on the ticket for the account's own conductor.
   */
  private function claim(BbTicketInterface $ticket, UserInterface $owner): void {
    $conductor = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')->create([
        'conductor_id' => 'node-' . $owner->id(),
        'label' => 'node-' . $owner->id(),
        'owner_user_id' => $owner->id(),
        'status' => 'online',
      ]);
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
    ])->save();
  }

  /**
   * Builds an unsaved comment anchored at the ticket.
   */
  private function buildComment(BbTicketInterface $ticket, UserInterface $author): BbCommentInterface {
    $comment = $this->container->get('entity_type.manager')->getStorage('bb_comment')
      ->create([
        'ticket_id' => $ticket->id(),
        'author' => $author->id(),
        'body' => ['value' => 'justification', 'format' => 'plain_text'],
        'type' => 'comment',
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $comment);
    return $comment;
  }

  /**
   * Returns the violation messages raised on `ticket_id`.
   *
   * @return array<string>
   *   The messages, in order.
   */
  private function violationMessages(BbCommentInterface $comment): array {
    $messages = [];
    foreach ($comment->validate()->getByField('ticket_id') as $violation) {
      $messages[] = (string) $violation->getMessage();
    }
    return $messages;
  }

}
