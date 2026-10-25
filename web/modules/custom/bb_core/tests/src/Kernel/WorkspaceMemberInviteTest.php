<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\og\OgRoleInterface;
use Drupal\og\Entity\OgRole;
use Drupal\bb_core\Members\MemberItemBuilder;
use Drupal\og\OgMembershipInterface;
use Drupal\og\Entity\OgMembership;
use Drupal\Core\Form\FormState;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbInvite;
use Drupal\bb_core\Entity\BbTicket;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\BbWorkspaceJoinForm;
use Drupal\bb_core\Form\GroupMembersForm;
use Drupal\bb_core\Form\WorkspaceInviteForm;
use Drupal\bb_core\Members\WorkspaceInvite;
use Drupal\user\EntityOwnerInterface;
use Drupal\og\Og;
use Drupal\user\UserInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Workspace\WorkspaceProvisioner;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\TestWith;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * A workspace Members POST creates a pending invitation, not a membership.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceMemberInviteTest extends KernelTestBase {

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
    'island', 'ui_patterns', 'bb_core',
  ];

  /**
   * The workspace admin role id, shipped as config with the label Admin.
   */
  private const string LEAD_ROLE = 'bb_workspace-bb_workspace-lead';

  /**
   * The workspace whose Members surface is under test.
   */
  private BbWorkspaceInterface $workspace;

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
    $this->installEntitySchema('bb_invite');
    $this->installConfig(['system', 'user', 'og']);
    Og::addGroup('bb_workspace', 'bb_workspace');
    Og::addGroup('bb_team', 'bb_team');
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->setUpCurrentUser(['uid' => 1]);

    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
  }

  /**
   * Submitting Invite on the workspace Members face stores a bb_invite.
   */
  public function testWorkspaceMembersPostCreatesAnInvite(): void {
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $address = 'invitee@example.com';

    $errors = $this->submitInvite($address);

    self::assertSame([], $errors, 'the submit reached the write without a validation error');
    $invites = $this->container->get('entity_type.manager')
      ->getStorage('bb_invite')
      ->loadByProperties([
        'workspace_id' => $this->workspace->id(),
        'email' => $address,
      ]);
    self::assertCount(1, $invites);
    $invite = reset($invites);
    self::assertInstanceOf(BbInvite::class, $invite);
    self::assertSame($address, $invite->getEmail());
  }

  /**
   * Inviting only an address that already belongs to a member is refused.
   *
   * A member is skipped, not invited; with nobody left to invite the whole
   * submit is refused on the address field.
   */
  public function testInvitingAnExistingMemberIsRefusedByName(): void {
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $member = $this->createUser([], NULL, FALSE, ['mail' => 'already-in@example.com']);
    self::assertInstanceOf(UserInterface::class, $member);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($member)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $errors = $this->submitInvite('already-in@example.com');

    self::assertSame('Everyone listed is already a member or invited.', $errors['emails'] ?? '');
    $invites = $this->container->get('entity_type.manager')
      ->getStorage('bb_invite')
      ->loadByProperties(['email' => 'already-in@example.com']);
    self::assertSame([], $invites, 'a refused invite writes nothing');
  }

  /**
   * A revoke posted on workspace A cannot delete workspace B's invitation.
   *
   * The form authorises `update` on the current group, then used to load the
   * submitted sequential id with no workspace match. A lead of A could POST
   * `revoke_invite_{id}` for B.
   */
  public function testRevokingForeignInviteIsNoOp(): void {
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $other = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Other', 'slug' => 'other']);
    $other->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $other);

    $invite = BbInvite::create([
      'workspace_id' => $other->id(),
      'email' => 'foreign@example.com',
    ]);
    $invite->save();
    $foreign_id = (int) $invite->id();
    self::assertGreaterThan(0, $foreign_id);

    $errors = $this->submitRevoke($foreign_id);

    self::assertSame([], $errors, 'the submit reached the write without a validation error');
    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_invite')
      ->load($foreign_id);
    self::assertInstanceOf(BbInvite::class, $reloaded);
    self::assertSame('foreign@example.com', $reloaded->getEmail());
    self::assertSame((string) $other->id(), (string) $reloaded->getWorkspace()?->id());
  }

  /**
   * A revoke posted for this workspace's own invitation still deletes it.
   */
  public function testRevokingOwnInviteDeletesIt(): void {
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $invite = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'own@example.com',
    ]);
    $invite->save();
    $own_id = (int) $invite->id();
    self::assertGreaterThan(0, $own_id);

    $errors = $this->submitRevoke($own_id);

    self::assertSame([], $errors, 'the submit reached the write without a validation error');
    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_invite')
      ->load($own_id);
    self::assertNull($reloaded);
  }

  /**
   * An invitation inside the validity period is live; one outside it is not.
   */
  public function testExpiryIsDerivedFromCreated(): void {
    $tenancyInvite = $this->container->get('bb_core.workspace_invite');
    self::assertInstanceOf(WorkspaceInvite::class, $tenancyInvite);
    $now = \Drupal::time()->getRequestTime();

    $live = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'live@example.com',
      'created' => $now - 3600,
    ]);
    $live->save();
    self::assertFalse($tenancyInvite->isExpired($live), 'an invitation created inside the period is live');

    $expired = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'expired@example.com',
      'created' => $now - ((WorkspaceInvite::VALIDITY_DAYS + 1) * 86400),
    ]);
    $expired->save();
    self::assertTrue($tenancyInvite->isExpired($expired), 'an invitation created outside the period is expired');
  }

  /**
   * One invitation, one mail: naming the workspace, inviter, period, link.
   */
  public function testInviteSendsOneMail(): void {
    $this->config('system.mail')->set('interface.default', 'test_mail_collector')->save();
    \Drupal::state()->set('system.test_mail_collector', []);
    $inviter = $this->actAs(['view bb_workspace', 'update any bb_workspace']);

    $this->submitInvite('newcomer@example.com');

    $captured = \Drupal::state()->get('system.test_mail_collector', []);
    $sent = array_values(array_filter($captured, static fn (array $mail): bool => $mail['id'] === 'bb_core_invite'));
    self::assertCount(1, $sent, 'exactly one mail was sent for the invitation');
    $mail = reset($sent);
    self::assertSame('newcomer@example.com', $mail['to']);
    $body = implode("\n", (array) $mail['body']);
    self::assertStringContainsString('Acme', $body, 'the body names the workspace');
    self::assertStringContainsString((string) $inviter->getDisplayName(), $body, 'the body names the inviter');
    self::assertStringContainsString((string) WorkspaceInvite::VALIDITY_DAYS, $body, 'the body states the validity period');
    self::assertStringContainsString('destination=', $body, 'the body carries a link with a destination');
  }

  /**
   * An expired invitation is refused at the join screen, not offered.
   */
  public function testExpiredInvitationRefusedAtJoin(): void {
    $now = \Drupal::time()->getRequestTime();
    $invite = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'stale@example.com',
      'created' => $now - ((WorkspaceInvite::VALIDITY_DAYS + 1) * 86400),
    ]);
    $invite->save();
    $account = $this->createUser([], NULL, FALSE, ['mail' => 'stale@example.com']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);

    $joinForm = $this->container->get('class_resolver')->getInstanceFromDefinition(BbWorkspaceJoinForm::class);
    self::assertInstanceOf(BbWorkspaceJoinForm::class, $joinForm);
    $form_state = new FormState();
    $built = $joinForm->buildForm([], $form_state, (string) $invite->id());
    self::assertArrayNotHasKey('actions', $built, 'the expired invitation renders no submit action');

    $this->expectException(AccessDeniedHttpException::class);
    $form_state->set('bb_invite', $invite);
    $joinForm->submitForm($built, $form_state);
  }

  /**
   * The invitation page names the workspace with its mark and description.
   */
  public function testInvitationShowsTheWorkspaceMarkAndDescription(): void {
    $this->workspace->set('description', "Where the invitee\n<b>will</b> work.")->save();
    $invite = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'curious@example.com',
    ]);
    $invite->save();
    $account = $this->createUser([], NULL, FALSE, ['mail' => 'curious@example.com']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);

    $joinForm = $this->container->get('class_resolver')->getInstanceFromDefinition(BbWorkspaceJoinForm::class);
    self::assertInstanceOf(BbWorkspaceJoinForm::class, $joinForm);
    $built = $joinForm->buildForm([], new FormState(), (string) $invite->id());

    self::assertSame('bb_theme:person', $built['workspace']['mark']['#component']);
    self::assertSame((string) $this->workspace->label(), $built['workspace']['mark']['#props']['display_name']);
    // Not a member yet: no private image to download, so the initials.
    self::assertSame('', $built['workspace']['mark']['#props']['picture']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    // Read as text, markup and all: the rendered copy, not the prop.
    $description = (string) $this->container->get('renderer')->renderInIsolation($built['workspace']['description']);
    self::assertStringContainsString("Where the invitee\n&lt;b&gt;will&lt;/b&gt; work.", $description);
    // The line break is shown as one.
    self::assertStringContainsString('whitespace-pre-line', $description);
    $keys = array_keys($built);
    self::assertLessThan(array_search('message', $keys, TRUE), array_search('workspace', $keys, TRUE), 'The mark precedes the sentence.');

    $this->workspace->set('description', '')->save();
    // The invite holds the workspace it loaded; a fresh request loads anew.
    $this->container->get('entity_type.manager')->getStorage('bb_invite')->resetCache();
    $plain = $joinForm->buildForm([], new FormState(), (string) $invite->id());
    self::assertArrayNotHasKey('description', $plain['workspace'], 'No description: no text.');
  }

  /**
   * A second redemption of an already-joined invitation finds nothing.
   */
  public function testSecondRedemptionAfterFirstFindsNothing(): void {
    $invite = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'joiner@example.com',
    ]);
    $invite->save();
    $invite_id = (int) $invite->id();
    $account = $this->createUser([], NULL, FALSE, ['mail' => 'joiner@example.com']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);

    $joinForm = $this->container->get('class_resolver')->getInstanceFromDefinition(BbWorkspaceJoinForm::class);
    self::assertInstanceOf(BbWorkspaceJoinForm::class, $joinForm);
    $form_state = new FormState();
    $form_state->set('bb_invite', $invite);
    $empty_form = [];
    $joinForm->submitForm($empty_form, $form_state);

    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_invite')
      ->load($invite_id);
    self::assertNull($reloaded, 'the invitation was consumed by the first join');

    // A second attempt at the same route now upcasts to NULL, and access()
    // answers with the invalid-invitation page rather than a 403.
    $access = $joinForm->access(NULL);
    self::assertTrue($access->isAllowed(), 'a consumed invitation renders the invalid page rather than 403ing');
  }

  /**
   * An expired invitation renders as expired and stays revocable.
   */
  public function testExpiredInvitationRendersExpiredAndStaysRevocable(): void {
    $now = \Drupal::time()->getRequestTime();
    $invite = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'longgone@example.com',
      'created' => $now - ((WorkspaceInvite::VALIDITY_DAYS + 1) * 86400),
    ]);
    $invite->save();
    $tenancyInvite = $this->container->get('bb_core.workspace_invite');
    self::assertInstanceOf(WorkspaceInvite::class, $tenancyInvite);

    $built = $tenancyInvite->inviteItems([$invite], TRUE, 'revoke_invite_');

    $state = $built['items'][0]['cells']['state'];
    self::assertSame('Expired', $state['label']);
    self::assertArrayHasKey('remove', $built['controls'][0], 'the revoke control is still offered');
  }

  /**
   * Ownership transfer: control present for the owner, absent for a lead.
   */
  public function testTransferControlVisibleOnlyToOwner(): void {
    $owner = $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $this->setWorkspaceOwner((int) $owner->id());
    $target = $this->createUser([], NULL, FALSE, ['mail' => 'future-owner@example.com']);
    self::assertInstanceOf(UserInterface::class, $target);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($target)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    // MemberItemBuilder is not a service; construct it the way
    // GroupMembersForm does.
    $itemBuilder = new MemberItemBuilder(
      $this->container->get('date.formatter'),
      $this->container->get('string_translation'),
      $this->container->get('module_handler'),
    );
    $memberships = array_values(array_filter(
      $this->container->get('entity_type.manager')->getStorage('og_membership')->loadMultiple(),
      static fn ($membership): bool => $membership instanceof OgMembershipInterface,
    ));

    $with_transfer = $itemBuilder->items($memberships, $this->workspace, TRUE, TRUE);
    $has_transfer = FALSE;
    $transfer_control = NULL;
    foreach ($with_transfer['controls'] as $controls) {
      if (isset($controls['transfer'])) {
        $has_transfer = TRUE;
        $transfer_control = $controls['transfer'];
      }
    }
    self::assertTrue($has_transfer, 'the owner is offered a transfer control for the other active member');
    // The control must render an actual glyph, not an empty icon_only button
    // (review verdict 823d8141: 'crown' resolved to nothing in the theme's
    // sprite, so the owner — the only actor shown this control — saw an
    // invisible button whose accessible name still passed every prior check).
    $rendered = (string) $this->container->get('renderer')->renderInIsolation($transfer_control);
    self::assertStringContainsString('<svg', $rendered, 'the transfer control renders a visible icon glyph');

    $without_transfer = $itemBuilder->items($memberships, $this->workspace, TRUE, FALSE);
    foreach ($without_transfer['controls'] as $controls) {
      self::assertArrayNotHasKey('transfer', $controls, 'a non-owner is offered no transfer control');
    }
  }

  /**
   * A non-owner's transfer submit is refused.
   *
   * A non-member target is refused; a successful transfer moves ownership and
   * leaves the previous owner holding the `lead` role.
   */
  public function testTransferSubmitIsAuthorisedAndWritesOwnership(): void {
    $owner = $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $this->setWorkspaceOwner((int) $owner->id());
    $lead = $this->createUser(['view bb_workspace', 'update any bb_workspace']);
    self::assertInstanceOf(UserInterface::class, $lead);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($lead)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    // A non-owner (the lead, holding `update`) cannot transfer.
    $this->setCurrentUser($lead);
    $this->expectException(AccessDeniedHttpException::class);
    $this->submitTransfer((int) $lead->id());
  }

  /**
   * A successful transfer moves the ownership field to the target.
   *
   * Run by the owner, and leaves the previous owner holding `lead`.
   */
  public function testSuccessfulTransferMovesOwnershipAndLeavesLead(): void {
    // The `lead` role lives in bb_core's own config, which this test does
    // not install wholesale (it drags in query-access subscribers this
    // schema does not support) — created directly, the same shape the
    // shipped config/install file states.
    OgRole::create([
      'id' => 'bb_workspace-bb_workspace-lead',
      'label' => 'Admin',
      'group_type' => 'bb_workspace',
      'group_bundle' => 'bb_workspace',
      'role_type' => OgRoleInterface::ROLE_TYPE_STANDARD,
      'permissions' => [],
    ])->save();

    $owner = $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $this->setWorkspaceOwner((int) $owner->id());
    $owner_id = (int) $owner->id();
    // The owner also holds their own active membership, the way
    // `WorkspaceProvisioner` leaves a real workspace: the previous owner has
    // to be an existing member for the role write to land anywhere.
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($owner)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    $target = $this->createUser([], NULL, FALSE, ['mail' => 'new-owner@example.com']);
    self::assertInstanceOf(UserInterface::class, $target);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($target)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $this->submitTransfer((int) $target->id());

    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->loadUnchanged($this->workspace->id());
    self::assertInstanceOf(BbWorkspaceInterface::class, $reloaded);
    self::assertInstanceOf(EntityOwnerInterface::class, $reloaded);
    self::assertSame((int) $target->id(), (int) $reloaded->getOwnerId());

    $storage = $this->container->get('entity_type.manager')->getStorage('og_membership');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('entity_type', 'bb_workspace')
      ->condition('entity_id', (string) $this->workspace->id())
      ->condition('uid', $owner_id)
      ->execute();
    $first_id = reset($ids);
    $previous_owner_membership = $first_id !== FALSE ? $storage->load($first_id) : NULL;
    self::assertInstanceOf(OgMembershipInterface::class, $previous_owner_membership);
    $role_names = array_map(
      static fn ($role): string => (string) $role->getName(),
      $previous_owner_membership->getRoles(),
    );
    self::assertContains('lead', $role_names, 'the previous owner keeps the lead role');
  }

  /**
   * A member sees no invite control and a direct invite submit is refused.
   *
   * Covers verification-plan row F6, both halves: the absent control AND a
   * POST that never rendered it, per `WORKFLOW.md` › *Standards* on posting
   * without rendering to exercise the actual hole.
   */
  public function testMemberSeesNoInviteControlAndCannotInvite(): void {
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $member = $this->createUser(['view bb_workspace']);
    self::assertInstanceOf(UserInterface::class, $member);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($member)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $this->setCurrentUser($member);
    $this->enterWorkspaceMembersRoute();
    $built = $this->container->get('form_builder')->getForm(
      GroupMembersForm::class,
      ['island_id' => 'members', 'host_id' => 'workspace'],
    );
    self::assertArrayNotHasKey('invite', $built, 'a member is offered no invite control');
    self::assertArrayNotHasKey('#bb_zone_actions', $built['roster'], 'a member is offered no invite button');

    $this->expectException(AccessDeniedHttpException::class);
    $this->submitInvite('member-cannot-invite@example.com');
  }

  /**
   * A member's direct role-change submit is refused, and writes nothing.
   *
   * The other half of F6: the submit re-check, not merely the absent control.
   */
  public function testMemberCannotChangeRole(): void {
    $owner = $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $this->setWorkspaceOwner((int) $owner->id());
    $member = $this->createUser(['view bb_workspace']);
    self::assertInstanceOf(UserInterface::class, $member);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($member)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    $target = $this->createUser([], NULL, FALSE, ['mail' => 'role-target@example.com']);
    self::assertInstanceOf(UserInterface::class, $target);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($target)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $this->setCurrentUser($member);
    try {
      $this->submitRole((int) $target->id(), 'lead');
      self::fail('a member submitting a role change must be refused');
    }
    catch (AccessDeniedHttpException) {
      // Expected: the submit re-check, not merely the absent control.
    }

    $reloaded = $this->membershipFor((int) $target->id());
    self::assertInstanceOf(OgMembershipInterface::class, $reloaded);
    $role_names = array_map(
      static fn ($role): string => (string) $role->getName(),
      $reloaded->getRoles(),
    );
    self::assertNotContains('lead', $role_names, 'the role was not changed by the refused submit');
  }

  /**
   * A lead (holding `update`, not the owner) may write a member's role.
   *
   * Covers the first half of criterion 3: "a lead administers roles".
   */
  public function testLeadCanWriteMemberRole(): void {
    OgRole::create([
      'id' => 'bb_workspace-bb_workspace-lead',
      'label' => 'Admin',
      'group_type' => 'bb_workspace',
      'group_bundle' => 'bb_workspace',
      'role_type' => OgRoleInterface::ROLE_TYPE_STANDARD,
      'permissions' => [],
    ])->save();

    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $lead = $this->createUser(['view bb_workspace', 'update any bb_workspace']);
    self::assertInstanceOf(UserInterface::class, $lead);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($lead)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    $target = $this->createUser([], NULL, FALSE, ['mail' => 'promoted@example.com']);
    self::assertInstanceOf(UserInterface::class, $target);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($target)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $this->setCurrentUser($lead);
    $this->submitRole((int) $target->id(), 'lead');

    $reloaded = $this->membershipFor((int) $target->id());
    self::assertInstanceOf(OgMembershipInterface::class, $reloaded);
    $role_names = array_map(
      static fn ($role): string => (string) $role->getName(),
      $reloaded->getRoles(),
    );
    self::assertContains('lead', $role_names, 'the lead raised the target to the lead role');
  }

  /**
   * A transfer naming a uid with no active membership writes nothing.
   *
   * Covers the non-member guard `OwnershipTransfer::transfer()` carries,
   * the second half of F9 the review found unexercised.
   */
  public function testTransferToNonMemberIsRefused(): void {
    $owner = $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $this->setWorkspaceOwner((int) $owner->id());
    $owner_id = (int) $owner->id();
    $stranger = $this->createUser([], NULL, FALSE, ['mail' => 'stranger@example.com']);
    self::assertInstanceOf(UserInterface::class, $stranger);

    $this->submitTransfer((int) $stranger->id());

    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->loadUnchanged($this->workspace->id());
    self::assertInstanceOf(EntityOwnerInterface::class, $reloaded);
    self::assertSame($owner_id, (int) $reloaded->getOwnerId(), 'ownership did not move to a non-member');
  }

  /**
   * Removing a member ends their access without touching their attribution.
   *
   * Covers verification-plan row F10 (criterion 4). Attribution is
   * represented here by a SECOND workspace the removed member owns —
   * `owner_user_id` on an entirely different entity — because the confirmed
   * spec resolved "deactivate" as "remove the og_membership", and what that
   * criterion actually guards is that the removal touches only the
   * membership row and nothing else naming the account.
   */
  public function testRemovingMemberKeepsAttributionElsewhere(): void {
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $member = $this->createUser([]);
    self::assertInstanceOf(UserInterface::class, $member);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($member)
      ->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    // The attribution F10 names is a ticket, inside the workspace under
    // test, that the removed member owns — not a sibling workspace's owner
    // field, which no removal code path can reach and would therefore pass
    // with the feature deleted entirely.
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('bb_ticket');
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create(['name' => 'Acme group', 'workspace_id' => $this->workspace->id()]);
    $group->save();
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'Acme project', 'group_id' => $group->id()]);
    $project->save();
    $ticket = BbTicket::create([
      'title' => 'Owned by the removed member',
      'workflow' => 'bb_work',
      'project_id' => $project->id(),
      'owner_user_id' => $member->id(),
    ]);
    $ticket->save();

    $this->submitRemove((int) $member->id());

    self::assertNull($this->membershipFor((int) $member->id()), 'the membership is gone');
    $reloaded_ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->loadUnchanged($ticket->id());
    self::assertInstanceOf(EntityOwnerInterface::class, $reloaded_ticket);
    self::assertSame(
      (int) $member->id(),
      (int) $reloaded_ticket->getOwnerId(),
      'removal did not touch the ticket the removed member owns',
    );
  }

  /**
   * A revoked and an expired invitation render the identical sentence.
   *
   * Neither offers a submit action. Covers verification-plan row F8
   * (criterion 8): the earlier assertion only
   * proved `access(NULL)` was allowed, never that the visitor is actually
   * told anything.
   */
  public function testInvalidInvitationPageIsIdenticalForRevokedAndExpired(): void {
    $now = \Drupal::time()->getRequestTime();
    $expired = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'expired-page@example.com',
      'created' => $now - ((WorkspaceInvite::VALIDITY_DAYS + 1) * 86400),
    ]);
    $expired->save();

    $joinForm = $this->container->get('class_resolver')->getInstanceFromDefinition(BbWorkspaceJoinForm::class);
    self::assertInstanceOf(BbWorkspaceJoinForm::class, $joinForm);

    $revoked_page = $joinForm->buildForm([], new FormState(), NULL);
    $expired_page = $joinForm->buildForm([], new FormState(), (string) $expired->id());

    self::assertArrayNotHasKey('actions', $revoked_page, 'the revoked page offers no submit');
    self::assertArrayNotHasKey('actions', $expired_page, 'the expired page offers no submit');
    $revoked_text = (string) $revoked_page['message']['#props']['text'];
    $expired_text = (string) $expired_page['message']['#props']['text'];
    self::assertNotSame('', $revoked_text, 'the revoked page actually tells the visitor something');
    self::assertSame($revoked_text, $expired_text, 'revoked and expired read the identical sentence');
  }

  /**
   * A revoked invitation's link answers 200 through the real router, not 404.
   *
   * The prior assertion above calls `buildForm()` directly and never crosses
   * the routing boundary, so it stayed green while `{bb_invite}` was still
   * `entity:bb_invite`-typed and a deleted id 404ed before `access()` or
   * `buildForm()` ever ran (review verdict `823d8141`). This one goes through
   * `http_kernel`, the way `WorkspaceRouteAccessTest` does, so the router, the
   * (now absent) param converter and the exception subscriber all
   * participate.
   */
  public function testRevokedInvitationLinkServesThePageThroughRouting(): void {
    $invite = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'revoked-routing@example.com',
    ]);
    $invite->save();
    $invite_id = (int) $invite->id();
    $account = $this->createUser([], NULL, FALSE, ['mail' => 'revoked-routing@example.com']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);
    $invite->delete();

    $request = Request::create('/home/join/' . $invite_id);
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();

    self::assertSame(200, $response->getStatusCode(), 'a revoked invitation serves the "no longer valid" page, not a 404');
    self::assertStringContainsString('no longer valid', (string) $response->getContent());
  }

  /**
   * The invitation mail body is identical whether the address has an account.
   *
   * Covers verification-plan row F3 (criterion 9). The bodies differ only in
   * the invitation id carried by the join link, which is masked before the
   * comparison.
   */
  public function testInviteMailBodyIdenticalRegardlessOfAccountExistence(): void {
    $this->config('system.mail')->set('interface.default', 'test_mail_collector')->save();
    \Drupal::state()->set('system.test_mail_collector', []);
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $this->createUser([], NULL, FALSE, ['mail' => 'has-account@example.com']);

    $this->submitInvite('has-account@example.com');
    $this->submitInvite('no-account@example.com');

    $captured = \Drupal::state()->get('system.test_mail_collector', []);
    $sent = array_values(array_filter($captured, static fn (array $mail): bool => $mail['id'] === 'bb_core_invite'));
    self::assertCount(2, $sent, 'one mail per invitation');
    $mask = static fn (array $mail): string => (string) preg_replace('/\d+/', 'N', implode("\n", (array) $mail['body']));
    self::assertSame(
      $mask($sent[0]),
      $mask($sent[1]),
      'the mail body carries no branch on whether the address already had an account',
    );
  }

  /**
   * The workspace face offers the dialog trigger, never the inline zone.
   */
  public function testTenancyFaceOffersDialogTriggerNotZone(): void {
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);

    $built = $this->container->get('form_builder')->getForm(
      GroupMembersForm::class,
      ['island_id' => 'members', 'host_id' => 'workspace'],
    );

    self::assertArrayNotHasKey('invite', $built);
    $trigger = $built['roster']['#bb_zone_actions'];
    self::assertSame('Invite members', (string) $trigger['#props']['label']);
    self::assertStringContainsString('_wrapper_format=island_dialog', (string) $trigger['#props']['attributes']['data-hx-get']);
  }

  /**
   * The dialog opens on Contributor and the first team, and explains roles.
   */
  public function testDialogOpensOnContributorAndFirstTeam(): void {
    $this->createLeadRole();
    $this->createStandardRole('contributor', 'Contributor');
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $platform = $this->createTeam($this->workspace, 'Platform');
    $alpha = $this->createTeam($this->workspace, 'Alpha');
    $this->createTeam($this->otherWorkspace(), 'Foreign');

    $built = $this->container->get('form_builder')->getForm(WorkspaceInviteForm::class);

    self::assertSame('Email addresses', (string) $built['emails']['#title']);
    $role = $built['workspace_role'];
    self::assertSame(['bb_workspace-bb_workspace-contributor'], $role['#default_value']);
    self::assertSame(WorkspaceProvisioner::WORKSPACE_MEMBER_ROLE, array_key_first($role['#picker_options']), 'member is listed first');
    self::assertSame('Manages members and sees every project.', $role['#picker_options'][self::LEAD_ROLE]['description']);
    self::assertArrayNotHasKey('bb_workspace-bb_workspace-non-member', $role['#picker_options']);
    $team = $built['team_id'];
    self::assertSame([(string) $alpha->id()], $team['#default_value'], 'the first team by name');
    self::assertSame([(int) $alpha->id(), (int) $platform->id()], array_keys($team['#picker_options']), "only this workspace's teams");
    self::assertSame('No team', $team['#picker_clear_label']);
  }

  /**
   * Several addresses become one invitation and one mail each.
   */
  public function testDialogInvitesSeveralAddresses(): void {
    $this->captureMail();
    $this->createLeadRole();
    $lead = $this->actAsMemberLead();
    $team = $this->createTeam($this->workspace, 'Platform');

    $errors = $this->submitInvite("one@example.com\ntwo@example.com, ONE@example.com", self::LEAD_ROLE, (string) $team->id());

    self::assertSame([], $errors);
    foreach (['one@example.com', 'two@example.com'] as $mail) {
      $invite = $this->inviteByMail($mail);
      self::assertInstanceOf(BbInvite::class, $invite, $mail . ' is invited');
      self::assertSame(self::LEAD_ROLE, $invite->getRoleId());
      self::assertSame((int) $team->id(), $invite->getTeamId());
      self::assertSame((string) $lead->id(), (string) $invite->get('owner_user_id')->target_id);
    }
    self::assertCount(2, $this->sentInviteMails(), 'one mail per address, the duplicate collapsed');
    self::assertSame(['Invited 2 people.'], $this->resultMessages());
  }

  /**
   * One malformed entry refuses the whole submit by name; nothing is written.
   */
  public function testMalformedEntryRefusesWholeSubmit(): void {
    $this->captureMail();
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);

    $errors = $this->submitInvite('good@example.com; not-an-address', NULL, '');

    self::assertSame('Not an e-mail address: not-an-address', $errors['emails'] ?? '');
    self::assertNull($this->inviteByMail('good@example.com'));
    self::assertSame([], $this->sentInviteMails());
  }

  /**
   * More than the cap is refused before anything is written.
   */
  public function testMoreThanTheCapIsRefused(): void {
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $many = implode(',', array_map(static fn (int $i): string => "p$i@example.com", range(1, WorkspaceInvite::MAX_ADDRESSES + 1)));

    $errors = $this->submitInvite($many, NULL, '');

    self::assertStringContainsString('at most 50', $errors['emails'] ?? '');
    self::assertNull($this->inviteByMail('p1@example.com'));
  }

  /**
   * Members and pending addresses are skipped and named; others invited.
   */
  public function testExistingMemberAndPendingAreSkippedAndReported(): void {
    $this->captureMail();
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $member = $this->createUser([], NULL, FALSE, ['mail' => 'in@example.com']);
    self::assertInstanceOf(UserInterface::class, $member);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($member)->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)->save();
    BbInvite::create(['workspace_id' => $this->workspace->id(), 'email' => 'waiting@example.com'])->save();

    $errors = $this->submitInvite("in@example.com\nwaiting@example.com\nnew@example.com", NULL, '');

    self::assertSame([], $errors);
    self::assertInstanceOf(BbInvite::class, $this->inviteByMail('new@example.com'));
    self::assertCount(1, $this->sentInviteMails());
    self::assertSame(
      ['Invited 1 person. Skipped: in@example.com (already a member), waiting@example.com (already invited).'],
      $this->resultMessages(),
    );
  }

  /**
   * Address lists split on lines, commas, semicolons and spaces.
   */
  public function testAddressListParsing(): void {
    $tenancyInvite = $this->container->get('bb_core.workspace_invite');
    self::assertInstanceOf(WorkspaceInvite::class, $tenancyInvite);

    self::assertSame(
      ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'],
      $tenancyInvite->parseAddresses(" a@example.com,b@example.com;\n\nc@example.com  d@example.com A@EXAMPLE.COM\n"),
    );
    self::assertSame([], $tenancyInvite->parseAddresses(['a@example.com']));
  }

  /**
   * The chosen role and team are stored; one mail is sent.
   */
  public function testInviteStoresChosenRoleAndTeam(): void {
    $this->captureMail();
    $this->createLeadRole();
    $this->actAsMemberLead();
    $team = $this->createTeam($this->workspace, 'Platform');

    $errors = $this->submitInvite('ranked@example.com', self::LEAD_ROLE, (string) $team->id());

    self::assertSame([], $errors);
    $invite = $this->inviteByMail('ranked@example.com');
    self::assertInstanceOf(BbInvite::class, $invite);
    self::assertSame(self::LEAD_ROLE, $invite->getRoleId());
    self::assertSame((int) $team->id(), $invite->getTeamId());
    self::assertCount(1, $this->sentInviteMails());
  }

  /**
   * Omitted picks store the member role explicitly and no team.
   */
  public function testInviteWithoutPicksGrantsMemberAndNoTeam(): void {
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);

    self::assertSame([], $this->submitInvite('plain@example.com', NULL, ''));

    $invite = $this->inviteByMail('plain@example.com');
    self::assertInstanceOf(BbInvite::class, $invite);
    self::assertSame(WorkspaceProvisioner::WORKSPACE_MEMBER_ROLE, $invite->getRoleId());
    self::assertNull($invite->getTeamId());
  }

  /**
   * A forged role or team is refused by field, with no invitation and no mail.
   *
   * @param string $field
   *   The field the error names.
   * @param string $case
   *   Which forged value to submit.
   */
  #[DataProvider('forgedPicks')]
  public function testForgedPicksAreRefused(string $field, string $case): void {
    $this->captureMail();
    $this->createLeadRole();
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $foreign_team = $this->createTeam($this->otherWorkspace(), 'Foreign');
    $values = [
      'unknown role' => ['bb_workspace-bb_workspace-ghost', NULL],
      'non-member role' => ['bb_workspace-bb_workspace-non-member', NULL],
      'other group type role' => ['bb_team-bb_team-member', NULL],
      'array role' => [['x'], NULL],
      'foreign team' => [NULL, (string) $foreign_team->id()],
      'unknown team' => [NULL, '999999'],
      'malformed team' => [NULL, 'abc'],
    ][$case];

    $errors = $this->submitInvite('forged@example.com', $values[0], $values[1]);

    self::assertArrayHasKey($field, $errors, $case . ' is refused on ' . $field);
    self::assertNull($this->inviteByMail('forged@example.com'), 'no invitation is written');
    self::assertSame([], $this->sentInviteMails(), 'no mail is sent');
  }

  /**
   * The forged cases and the field each must be refused on.
   *
   * @return array<string, array{string, string}>
   *   Field and case.
   */
  public static function forgedPicks(): array {
    return [
      'unknown role' => ['workspace_role', 'unknown role'],
      'non-member role' => ['workspace_role', 'non-member role'],
      'other group type role' => ['workspace_role', 'other group type role'],
      'array role' => ['workspace_role', 'array role'],
      'foreign team' => ['team_id', 'foreign team'],
      'unknown team' => ['team_id', 'unknown team'],
      'malformed team' => ['workspace_role', 'malformed team'],
    ];
  }

  /**
   * An entity write without update on the workspace is refused (JSON:API path).
   */
  public function testEntityValidationRefusesActorWithoutUpdate(): void {
    $this->createLeadRole();
    $this->setUpCurrentUser([], ['view bb_workspace', 'create bb_invite']);
    $invite = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'api@example.com',
      'workspace_role' => self::LEAD_ROLE,
    ]);

    $violations = $invite->validate()->getByFields(['workspace_role']);

    self::assertGreaterThan(0, $violations->count(), 'a caller who may not administer the crew cannot grant a role');
  }

  /**
   * Leading both workspaces does not make one's team assignable on the other.
   */
  public function testEntityValidationRefusesCrossWorkspaceTeamForLeadOfBoth(): void {
    $this->actAs(['view bb_workspace', 'update any bb_workspace']);
    $foreign_team = $this->createTeam($this->otherWorkspace(), 'Foreign');
    $invite = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'api@example.com',
      'team_id' => $foreign_team->id(),
    ]);

    self::assertGreaterThan(0, $invite->validate()->getByFields(['team_id'])->count());
  }

  /**
   * The pending list names each invitation's role and team, or why it cannot.
   */
  public function testPendingItemsNameRoleAndTeam(): void {
    $this->createLeadRole();
    $team = $this->createTeam($this->workspace, 'Platform');
    $gone = $this->createTeam($this->workspace, 'Gone');
    $ranked = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'a@example.com',
      'workspace_role' => self::LEAD_ROLE,
      'team_id' => $team->id(),
    ]);
    $legacy = BbInvite::create(['workspace_id' => $this->workspace->id(), 'email' => 'b@example.com']);
    $stale = BbInvite::create([
      'workspace_id' => $this->workspace->id(),
      'email' => 'c@example.com',
      'workspace_role' => 'bb_workspace-bb_workspace-ghost',
      'team_id' => $gone->id(),
    ]);
    $gone->delete();
    $tenancyInvite = $this->container->get('bb_core.workspace_invite');
    self::assertInstanceOf(WorkspaceInvite::class, $tenancyInvite);

    $items = $tenancyInvite->inviteItems([$ranked, $legacy, $stale], TRUE, 'revoke_invite_')['items'];

    self::assertSame(['Admin', 'Platform'], [$items[0]['cells']['role']['label'], $items[0]['cells']['team']['value']]);
    self::assertSame(['Member', 'No team'], [$items[1]['cells']['role']['label'], $items[1]['cells']['team']['value']]);
    self::assertSame(
      ['Role unavailable', 'Team unavailable'],
      [$items[2]['cells']['role']['label'], $items[2]['cells']['team']['value']],
    );
  }

  /**
   * Accepting grants exactly the chosen rank and an ordinary team membership.
   */
  public function testAcceptGrantsChosenRoleAndTeam(): void {
    $this->createLeadRole();
    $team = $this->createTeam($this->workspace, 'Platform');
    [$invite_id, $account] = $this->pendingInviteFor('admin-to-be@example.com', self::LEAD_ROLE, (int) $team->id());

    self::assertSame([], $this->join($invite_id));

    $membership = Og::getMembership($this->workspace, $account);
    self::assertInstanceOf(OgMembershipInterface::class, $membership);
    self::assertSame([self::LEAD_ROLE], array_values(array_diff($membership->getRolesIds(), [WorkspaceProvisioner::WORKSPACE_MEMBER_ROLE])), 'exactly the chosen standard role');
    self::assertContains(WorkspaceProvisioner::WORKSPACE_MEMBER_ROLE, array_map(static fn ($role) => $role->id(), $membership->getRoles()), 'OG\'s implicit member role is present');
    $team_membership = Og::getMembership($team, $account);
    self::assertInstanceOf(OgMembershipInterface::class, $team_membership);
    self::assertNotContains(WorkspaceProvisioner::TEAM_LEAD_ROLE, $team_membership->getRolesIds(), 'an ordinary team member');
    self::assertNull($this->reloadInvite($invite_id), 'the invitation is consumed');
  }

  /**
   * Accepting a member invitation stores no standard rank.
   */
  public function testAcceptMemberStoresNoStandardRank(): void {
    $this->createLeadRole();
    [$invite_id, $account] = $this->pendingInviteFor('member-to-be@example.com', WorkspaceProvisioner::WORKSPACE_MEMBER_ROLE, NULL);

    self::assertSame([], $this->join($invite_id));

    $membership = Og::getMembership($this->workspace, $account);
    self::assertInstanceOf(OgMembershipInterface::class, $membership);
    self::assertNotContains(self::LEAD_ROLE, $membership->getRolesIds());
  }

  /**
   * A team deleted or moved since inviting is skipped; the join holds.
   *
   * @param bool $moved
   *   TRUE to move the team, FALSE to delete it.
   */
  #[TestWith([FALSE])]
  #[TestWith([TRUE])]
  public function testAcceptSkipsDeletedOrMovedTeam(bool $moved): void {
    $this->createLeadRole();
    $team = $this->createTeam($this->workspace, 'Platform');
    [$invite_id, $account] = $this->pendingInviteFor('teamless@example.com', self::LEAD_ROLE, (int) $team->id());
    if ($moved) {
      $team->set('workspace_id', $this->otherWorkspace()->id())->save();
    }
    else {
      $team->delete();
    }

    self::assertSame([], $this->join($invite_id));

    $membership = Og::getMembership($this->workspace, $account);
    self::assertInstanceOf(OgMembershipInterface::class, $membership);
    self::assertContains(self::LEAD_ROLE, $membership->getRolesIds());
    if ($moved) {
      self::assertNull(Og::getMembership($team, $account, OgMembershipInterface::ALL_STATES), 'never joins the foreign team');
    }
    self::assertNull($this->reloadInvite($invite_id));
  }

  /**
   * A vanished explicit role fails closed and keeps the invitation.
   */
  public function testAcceptRefusesVanishedRole(): void {
    $this->createLeadRole();
    [$invite_id, $account] = $this->pendingInviteFor('stranded@example.com', self::LEAD_ROLE, NULL);
    OgRole::load(self::LEAD_ROLE)?->delete();

    $errors = $this->join($invite_id);

    self::assertNotSame([], $errors);
    self::assertNull(Og::getMembership($this->workspace, $account, OgMembershipInterface::ALL_STATES));
    self::assertInstanceOf(BbInvite::class, $this->reloadInvite($invite_id));
  }

  /**
   * An active member keeps their rank; the missing team membership is added.
   */
  public function testAcceptKeepsExistingRankAndAddsTeam(): void {
    $this->createLeadRole();
    $team = $this->createTeam($this->workspace, 'Platform');
    [$invite_id, $account] = $this->pendingInviteFor('already@example.com', self::LEAD_ROLE, (int) $team->id());
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($account)->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)->save();

    self::assertSame([], $this->join($invite_id));

    $membership = Og::getMembership($this->workspace, $account);
    self::assertInstanceOf(OgMembershipInterface::class, $membership);
    self::assertNotContains(self::LEAD_ROLE, $membership->getRolesIds(), 'the existing rank is not changed');
    self::assertInstanceOf(OgMembershipInterface::class, Og::getMembership($team, $account));
    self::assertNull($this->reloadInvite($invite_id));
  }

  /**
   * A blocked membership refuses acceptance and keeps the invitation.
   */
  public function testAcceptRefusesBlockedMembership(): void {
    [$invite_id, $account] = $this->pendingInviteFor('blocked@example.com', NULL, NULL);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($account)->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_BLOCKED)->save();

    self::assertNotSame([], $this->join($invite_id));

    $membership = Og::getMembership($this->workspace, $account, OgMembershipInterface::ALL_STATES);
    self::assertInstanceOf(OgMembershipInterface::class, $membership);
    self::assertSame(OgMembershipInterface::STATE_BLOCKED, $membership->getState());
    self::assertInstanceOf(BbInvite::class, $this->reloadInvite($invite_id));
  }

  /**
   * A failing team write rolls the workspace membership back; the invite stays.
   */
  public function testAcceptRollsBackOnFailedTeamWrite(): void {
    $team = $this->createTeam($this->workspace, 'Platform');
    [$invite_id, $account] = $this->pendingInviteFor('rollback@example.com', NULL, (int) $team->id());
    // A team bundle that is no longer a group makes the second write throw.
    Og::removeGroup('bb_team', 'bb_team');

    try {
      $this->join($invite_id);
      self::fail('the failed team write must surface');
    }
    catch (\Exception) {
      // Expected.
    }

    $this->container->get('entity_type.manager')->getStorage('og_membership')->resetCache();
    $ids = $this->container->get('entity_type.manager')->getStorage('og_membership')->getQuery()
      ->accessCheck(FALSE)->condition('uid', $account->id())->execute();
    self::assertSame([], $ids, 'no membership survives the rollback');
    self::assertInstanceOf(BbInvite::class, $this->reloadInvite($invite_id));
  }

  /**
   * An invitation revoked after the page rendered cannot be redeemed.
   */
  public function testRevokedAfterRenderCannotRedeem(): void {
    [$invite_id] = $this->pendingInviteFor('late@example.com', NULL, NULL);
    $invite = $this->reloadInvite($invite_id);
    self::assertInstanceOf(BbInvite::class, $invite);
    $form_state = new FormState();
    $form_state->set('bb_invite', $invite);
    $invite->delete();

    $this->expectException(AccessDeniedHttpException::class);
    $form = [];
    $this->joinForm()->submitForm($form, $form_state);
  }

  /**
   * The admin role, as config ships it.
   */
  private function createLeadRole(): void {
    OgRole::create([
      'id' => self::LEAD_ROLE,
      'label' => 'Admin',
      'group_type' => 'bb_workspace',
      'group_bundle' => 'bb_workspace',
      'role_type' => OgRoleInterface::ROLE_TYPE_STANDARD,
      'permissions' => [],
    ])->save();
  }

  /**
   * A team of a workspace.
   */
  private function createTeam(BbWorkspaceInterface $workspace, string $name): BbTeamInterface {
    $team = $this->container->get('entity_type.manager')->getStorage('bb_team')
      ->create(['name' => $name, 'workspace_id' => $workspace->id()]);
    $team->save();
    self::assertInstanceOf(BbTeamInterface::class, $team);
    return $team;
  }

  /**
   * A second workspace, created once.
   */
  private function otherWorkspace(): BbWorkspaceInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_workspace');
    $existing = $storage->loadByProperties(['slug' => 'other']);
    $other = $existing !== [] ? reset($existing) : $storage->create(['name' => 'Other', 'slug' => 'other']);
    $other->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $other);
    return $other;
  }

  /**
   * A saved invitation and the matching, current account.
   *
   * @return array{int, \Drupal\user\UserInterface}
   *   The invitation id and the account.
   */
  private function pendingInviteFor(string $mail, ?string $role, ?int $team): array {
    $invite = BbInvite::create(array_filter([
      'workspace_id' => $this->workspace->id(),
      'email' => $mail,
      'workspace_role' => $role,
      'team_id' => $team,
    ], static fn ($value): bool => $value !== NULL));
    $invite->save();
    $account = $this->createUser([], NULL, FALSE, ['mail' => $mail]);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);
    return [(int) $invite->id(), $account];
  }

  /**
   * Submits the join form for an invitation; returns error messages.
   *
   * @return array<int, string>
   *   The messenger's error messages.
   */
  private function join(int $invite_id): array {
    $invite = $this->reloadInvite($invite_id);
    self::assertInstanceOf(BbInvite::class, $invite);
    $form_state = new FormState();
    $form_state->set('bb_invite', $invite);
    $form = [];
    $messenger = $this->container->get('messenger');
    $messenger->deleteAll();
    $this->joinForm()->submitForm($form, $form_state);
    return array_map('strval', $messenger->messagesByType('error'));
  }

  /**
   * The join form.
   */
  private function joinForm(): BbWorkspaceJoinForm {
    $form = $this->container->get('class_resolver')->getInstanceFromDefinition(BbWorkspaceJoinForm::class);
    self::assertInstanceOf(BbWorkspaceJoinForm::class, $form);
    return $form;
  }

  /**
   * An invitation reloaded past the static cache.
   */
  private function reloadInvite(int $id): ?BbInvite {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_invite');
    $storage->resetCache();
    $invite = $storage->load($id);
    return $invite instanceof BbInvite ? $invite : NULL;
  }

  /**
   * This workspace's invitation for an address.
   */
  private function inviteByMail(string $mail): ?BbInvite {
    $invites = $this->container->get('entity_type.manager')->getStorage('bb_invite')
      ->loadByProperties(['workspace_id' => $this->workspace->id(), 'email' => $mail]);
    $invite = reset($invites);
    return $invite instanceof BbInvite ? $invite : NULL;
  }

  /**
   * Routes mail into the test collector.
   */
  private function captureMail(): void {
    $this->config('system.mail')->set('interface.default', 'test_mail_collector')->save();
    \Drupal::state()->set('system.test_mail_collector', []);
  }

  /**
   * Invitation mails sent so far.
   *
   * @return array<int, array<string, mixed>>
   *   The mails.
   */
  private function sentInviteMails(): array {
    $captured = \Drupal::state()->get('system.test_mail_collector', []);
    return array_values(array_filter($captured, static fn (array $mail): bool => $mail['id'] === 'bb_core_invite'));
  }

  /**
   * A standard workspace role, as config ships it.
   */
  private function createStandardRole(string $name, string $label): void {
    OgRole::create([
      'id' => 'bb_workspace-bb_workspace-' . $name,
      'label' => $label,
      'group_type' => 'bb_workspace',
      'group_bundle' => 'bb_workspace',
      'role_type' => OgRoleInterface::ROLE_TYPE_STANDARD,
      'permissions' => [],
    ])->save();
  }

  /**
   * Acts as a lead who is a member, as a real one is.
   *
   * `view bb_team` stands in for what the lead role grants through OG; it is
   * what lets the lead reference a team of their workspace.
   */
  private function actAsMemberLead(): UserInterface {
    $lead = $this->actAs(['view bb_workspace', 'update any bb_workspace', 'view bb_team']);
    OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($lead)->setGroup($this->workspace)
      ->setState(OgMembershipInterface::STATE_ACTIVE)->save();
    return $lead;
  }

  /**
   * The dialog's confirmation, as the Members face would render it.
   *
   * @return array<int, string>
   *   The messages, consumed.
   */
  private function resultMessages(): array {
    return array_map('strval', $this->container->get('messenger')->messagesByType(WorkspaceInviteForm::RESULT_MESSAGE_TYPE));
  }

  /**
   * This workspace's active membership for one account, if it holds one.
   */
  private function membershipFor(int $uid): ?OgMembershipInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('og_membership');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('entity_type', 'bb_workspace')
      ->condition('entity_id', (string) $this->workspace->id())
      ->condition('uid', $uid)
      ->execute();
    $id = reset($ids);
    if ($id === FALSE) {
      return NULL;
    }
    $membership = $storage->load($id);
    return $membership instanceof OgMembershipInterface ? $membership : NULL;
  }

  /**
   * Submits a role-change trigger, the way the island POST does.
   */
  private function submitRole(int $target_uid, string $value): void {
    $form_state = new FormState();
    $form_state->setValues([
      'member_role_' . $target_uid => $value,
    ]);
    $this->container->get('form_builder')->submitForm(
      GroupMembersForm::class,
      $form_state,
      ['island_id' => 'members', 'host_id' => 'workspace'],
    );
  }

  /**
   * Submits a remove trigger, the way the island POST does.
   */
  private function submitRemove(int $target_uid): void {
    $form_state = new FormState();
    $form_state->setValues([
      'remove_member_' . $target_uid => (string) $target_uid,
    ]);
    $this->container->get('form_builder')->submitForm(
      GroupMembersForm::class,
      $form_state,
      ['island_id' => 'members', 'host_id' => 'workspace'],
    );
  }

  /**
   * Sets the fixture workspace's owner.
   *
   * Narrowed past the interface's `getOwnerId()`/`setOwnerId()` gap:
   * `BbWorkspaceInterface` does not itself extend `EntityOwnerInterface`,
   * though `BbWorkspace` implements both.
   */
  private function setWorkspaceOwner(int $uid): void {
    self::assertInstanceOf(EntityOwnerInterface::class, $this->workspace);
    $this->workspace->setOwnerId($uid)->save();
  }

  /**
   * Submits a transfer trigger, the way the island POST does.
   */
  private function submitTransfer(int $target_uid): void {
    $form_state = new FormState();
    $form_state->setValues([
      'transfer_owner_' . $target_uid => (string) $target_uid,
    ]);
    $this->container->get('form_builder')->submitForm(
      GroupMembersForm::class,
      $form_state,
      ['island_id' => 'members', 'host_id' => 'workspace'],
    );
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
    $this->enterWorkspaceMembersRoute();
    return $account;
  }

  /**
   * Submits the invite dialog for one or more addresses.
   *
   * An omitted pick submits the dialog's default; `''` clears the team.
   *
   * @return array<string, string>
   *   The validation errors.
   */
  private function submitInvite(string $mails, mixed $role = NULL, mixed $team = NULL): array {
    $form_state = new FormState();
    $form_state->setValues(array_filter([
      'emails' => $mails,
      'workspace_role' => $role,
      'team_id' => $team,
      'op' => 'Invite',
    ], static fn ($value): bool => $value !== NULL));
    $this->container->get('form_builder')->submitForm(WorkspaceInviteForm::class, $form_state);
    return array_map(
      static fn ($message): string => (string) $message,
      $form_state->getErrors(),
    );
  }

  /**
   * Submits a pending-invite revoke, the way the island POST does.
   *
   * `setValues()` rather than `setUserInput()`: FormBuilder::submitForm()
   * overwrites the input with the values, so the values are how a
   * programmatic submit reaches a form that reads its trigger out of the
   * input.
   *
   * @return array<string, string>
   *   The validation errors.
   */
  private function submitRevoke(int $id, array $abandoned = []): array {
    $form_state = new FormState();
    $form_state->setValues($abandoned + [
      'revoke_invite_' . $id => (string) $id,
    ]);
    $this->container->get('form_builder')->submitForm(
      GroupMembersForm::class,
      $form_state,
      ['island_id' => 'members', 'host_id' => 'workspace'],
    );
    return array_map(
      static fn ($message): string => (string) $message,
      $form_state->getErrors(),
    );
  }

  /**
   * Makes the workspace Members route the current one.
   */
  private function enterWorkspaceMembersRoute(): void {
    $route_name = 'bb_core.bb_workspace.members';
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $request = Request::create('/workspace-member-invite-test');
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('bb_workspace', $this->workspace);
    $this->container->get('request_stack')->push($request);
  }

}
