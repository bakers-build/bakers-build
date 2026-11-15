<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Entity\EntityReferenceSelection\SelectionInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Claim\ClaimConflictException;
use Drupal\bb_core\Claim\TicketStallReason;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A conductor serves a project only while its owner can access that project.
 *
 * Access is the read scope (a team of the project, or workspace Admin) plus a
 * working rank (Contributor or Admin) in the project's workspace.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorOwnerAccessTest extends KernelTestBase {

  use UserCreationTrait;
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
   * The conductor owner, removed from the project's team in each case.
   */
  private UserInterface $owner;

  /**
   * The owner's conductor in project B.
   */
  private BbConductorInterface $conductor;

  /**
   * {@inheritdoc}
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    // A claim writes the run log under private://; see ClaimKernelTestBase.
    $container->register('stream_wrapper.private', 'Drupal\Core\StreamWrapper\PrivateStream')
      ->addTag('stream_wrapper', ['scheme' => 'private']);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('file');
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();

    $this->owner = $this->createAccount('conductor-owner');
    $this->addMembership($this->fixture('b', 'bb_workspace'), $this->owner, ['contributor']);
    $this->addMembership($this->fixture('b', 'bb_team'), $this->owner);
    $conductor = $this->createEntity('bb_conductor', [
      'conductor_id' => 'node-owner',
      'label' => 'node-owner',
      'status' => 'online',
      'project_id' => $this->fixture('b', 'bb_project')->id(),
      'owner_user_id' => $this->owner->id(),
      'states' => ['plan'],
      // Teammates assign it in these cases; the setting has its own tests.
      'assignment' => 'allow',
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    $this->conductor = $conductor;

    // The reported condition: the owner leaves the project's only team.
    Og::getMembership($this->fixture('b', 'bb_team'), $this->owner, OgMembershipInterface::ALL_STATES)?->delete();
    $this->container->get('cache.static')->deleteAll();
  }

  /**
   * Newly assigning a conductor whose owner lost access is refused.
   */
  public function testAssigningConductorOfOwnerWithoutAccessIsRejected(): void {
    $ticket = $this->ticketEditedByContributor();
    $ticket->set('conductor_id', $this->conductor->id());

    self::assertSame(
      ['Conductor node-owner cannot be assigned: its owner has no access to this project.'],
      $this->conductorViolations($ticket),
    );
  }

  /**
   * A ticket already on the stranded conductor still saves unrelated edits.
   */
  public function testUnchangedStrandedConductorStillValidates(): void {
    $ticket = $this->fixture('b', 'bb_ticket');
    $ticket->set('conductor_id', $this->conductor->id())->save();
    $ticket = $this->ticketEditedByContributor();
    $ticket->set('title', 'edited');

    self::assertSame([], $this->conductorViolations($ticket));
  }

  /**
   * Claim-next skips a ticket assigned to the conductor.
   */
  public function testClaimNextSkipsAssignedTicket(): void {
    $this->createAssignedPlanTicket();

    self::assertNull($this->container->get('bb_core.ticket_claim')->claimNext($this->conductor));
  }

  /**
   * Claim-next skips an unclassified ticket any conductor may qualify.
   */
  public function testClaimNextSkipsUnclassifiedTicket(): void {
    $this->createEntity('bb_ticket', [
      'identifier' => 'T-UNCLASSIFIED',
      'title' => 'unclassified',
      'project_id' => $this->fixture('b', 'bb_project')->id(),
    ]);

    self::assertNull($this->container->get('bb_core.ticket_claim')->claimNext($this->conductor));
  }

  /**
   * Claiming a specific ticket is refused as a conflict.
   */
  public function testDirectClaimIsRefused(): void {
    $ticket = $this->createAssignedPlanTicket();

    $this->expectException(ClaimConflictException::class);
    $this->expectExceptionMessage('claim_conflict: conductor owner has no access to the project.');
    $this->container->get('bb_core.ticket_claim')->claim($ticket, $this->conductor);
  }

  /**
   * Regaining access restores assignment and claim at once.
   */
  public function testRegainedAccessRestoresEligibility(): void {
    $this->createAssignedPlanTicket();
    $this->addMembership($this->fixture('b', 'bb_team'), $this->owner);

    $ticket = $this->ticketEditedByContributor();
    $ticket->set('conductor_id', $this->conductor->id());
    self::assertSame([], $this->conductorViolations($ticket));
    self::assertInstanceOf(BbRunInterface::class, $this->container->get('bb_core.ticket_claim')->claimNext($this->conductor));
  }

  /**
   * A workspace Admin needs no team.
   */
  public function testWorkspaceAdminWithoutTeamHasAccess(): void {
    $this->addMembership($this->fixture('b', 'bb_workspace'), $this->owner, ['lead']);

    $ticket = $this->ticketEditedByContributor();
    $ticket->set('conductor_id', $this->conductor->id());

    self::assertSame([], $this->conductorViolations($ticket));
  }

  /**
   * A team member with only the Guest rank has no access.
   */
  public function testGuestInTeamHasNoAccess(): void {
    $this->addMembership($this->fixture('b', 'bb_workspace'), $this->owner, ['guest']);
    $this->addMembership($this->fixture('b', 'bb_team'), $this->owner);

    $ticket = $this->ticketEditedByContributor();
    $ticket->set('conductor_id', $this->conductor->id());

    self::assertSame(
      ['Conductor node-owner cannot be assigned: its owner has no access to this project.'],
      $this->conductorViolations($ticket),
    );
  }

  /**
   * The owner may always set their own conductor, even under forbid.
   */
  public function testOwnerMayAssignOwnConductorUnderForbid(): void {
    [$member, $conductor] = $this->memberWithConductor('member', 'forbid');
    $ticket = $this->ticketEditedBy($member);
    $ticket->set('conductor_id', $conductor->id());

    self::assertSame([], $this->conductorViolations($ticket));
  }

  /**
   * Under allow, any teammate who sees the conductor may set it.
   */
  public function testTeammateMayAssignUnderAllow(): void {
    [, $conductor] = $this->memberWithConductor('member', 'machine', 'allow');
    $ticket = $this->ticketEditedByContributor();
    $ticket->set('assignee_user_id', $this->owner->id());
    $ticket->set('conductor_id', $conductor->id());

    self::assertSame([], $this->conductorViolations($ticket));
  }

  /**
   * Under forbid a teammate and a workspace Admin are refused, with the source.
   */
  public function testTeammateAndAdminRefusedUnderForbid(): void {
    [, $by_machine] = $this->memberWithConductor('member', 'machine', 'forbid');
    [, $by_conductor] = $this->memberWithConductor('other', 'forbid', 'allow');
    $admin = $this->createAccount('ws-admin', ['view bb_conductor']);
    $this->addMembership($this->fixture('b', 'bb_workspace'), $admin, ['lead']);

    foreach ([$this->ticketEditedByContributor(), $this->ticketEditedBy($admin)] as $ticket) {
      $ticket->set('conductor_id', $by_machine->id());
      self::assertSame(
        ['Conductor node-member cannot be assigned: its owner member forbids assignment by others (machine setting).'],
        $this->conductorViolations($ticket),
      );
      $ticket->set('conductor_id', $by_conductor->id());
      self::assertSame(
        ['Conductor node-other cannot be assigned: its owner other forbids assignment by others (conductor setting).'],
        $this->conductorViolations($ticket),
      );
    }
  }

  /**
   * A ticket already on a forbid conductor still saves a title edit.
   */
  public function testStrandedForbidConductorStillSavesTitleEdit(): void {
    [, $conductor] = $this->memberWithConductor('member', 'forbid');
    $this->fixture('b', 'bb_ticket')->set('conductor_id', $conductor->id())->save();
    $ticket = $this->ticketEditedByContributor();
    $ticket->set('title', 'edited');

    self::assertSame([], $this->conductorViolations($ticket));
  }

  /**
   * Deactivation hands the ticket to the owner's sibling whatever its setting.
   */
  public function testReassignerIgnoresAssignmentSetting(): void {
    [$member, $conductor] = $this->memberWithConductor('member');
    $sibling = $this->createEntity('bb_conductor', [
      'conductor_id' => 'node-member-sibling',
      'label' => 'node-member-sibling',
      'status' => 'online',
      'project_id' => $this->fixture('b', 'bb_project')->id(),
      'owner_user_id' => $member->id(),
      'assignment' => 'forbid',
    ]);
    $ticket = $this->fixture('b', 'bb_ticket');
    $ticket->set('conductor_id', $conductor->id())->save();
    $this->ticketEditedByContributor();

    $conductor->set('active', FALSE)->save();

    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    self::assertSame((string) $sibling->id(), (string) $ticket->get('conductor_id')->target_id);
  }

  /**
   * Being the assignee never bypasses the access rule.
   */
  public function testAssigneeWithoutAccessIsStillRefused(): void {
    $ticket = $this->ticketEditedByContributor();
    $ticket->set('assignee_user_id', $this->owner->id());
    $ticket->set('conductor_id', $this->conductor->id());

    self::assertSame(
      ['Conductor node-owner cannot be assigned: its owner has no access to this project.'],
      $this->conductorViolations($ticket),
    );
  }

  /**
   * Without an assignee, access suffices and the owner becomes the assignee.
   */
  public function testTicketWithoutAssigneeTakesConductorOwner(): void {
    [$member, $member_conductor] = $this->memberWithConductor('member');
    $ticket = $this->ticketEditedByContributor();
    self::assertTrue($ticket->get('assignee_user_id')->isEmpty());
    $ticket->set('conductor_id', $member_conductor->id());

    self::assertSame([], $this->conductorViolations($ticket));
    $ticket->save();
    self::assertSame((string) $member->id(), (string) $ticket->get('assignee_user_id')->target_id);
  }

  /**
   * Deactivating hands no ticket to a sibling whose owner lost access.
   */
  public function testDeactivationDoesNotMoveTicketToSiblingWithoutAccess(): void {
    $sibling = $this->createEntity('bb_conductor', [
      'conductor_id' => 'node-sibling',
      'label' => 'node-sibling',
      'status' => 'online',
      'project_id' => $this->fixture('b', 'bb_project')->id(),
      'owner_user_id' => $this->owner->id(),
    ]);
    $ticket = $this->createAssignedPlanTicket();

    $this->conductor->set('active', FALSE)->save();

    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    self::assertNotSame((string) $sibling->id(), (string) $ticket->get('conductor_id')->target_id);
    self::assertTrue($ticket->get('conductor_id')->isEmpty());
  }

  /**
   * A stranded ticket names why it waits, until access returns.
   */
  public function testStrandedTicketShowsConductorNoAccess(): void {
    $ticket = $this->createAssignedPlanTicket();
    $reasons = $this->container->get('bb_core.ticket_stall_reason');

    self::assertSame('conductor no access', $reasons->reasonFor($ticket));
    self::assertSame('conductor has no access', TicketStallReason::label('conductor no access'));
    self::assertContains('og_membership_list', TicketStallReason::cacheability($ticket)->getCacheTags());

    $this->addMembership($this->fixture('b', 'bb_team'), $this->owner);
    self::assertSame('', $reasons->reasonFor($ticket));
  }

  /**
   * The picker leaves out a conductor whose owner has no access.
   */
  public function testPickerOmitsConductorOfOwnerWithoutAccess(): void {
    [, $member_conductor] = $this->memberWithConductor('member');

    $offered = $this->pickerOptions($this->ticketEditedByContributor());

    self::assertContains((int) $member_conductor->id(), $offered);
    self::assertNotContains((int) $this->conductor->id(), $offered);
  }

  /**
   * The picker keeps a stranded conductor that is the current reference.
   */
  public function testPickerKeepsStrandedCurrentConductor(): void {
    $this->fixture('b', 'bb_ticket')->set('conductor_id', $this->conductor->id())->save();

    self::assertContains((int) $this->conductor->id(), $this->pickerOptions($this->ticketEditedByContributor()));
  }

  /**
   * The picker offers each actor only the conductors they may set.
   */
  public function testPickerOffersOnlyAssignableConductors(): void {
    [$member, $forbidden] = $this->memberWithConductor('member', 'forbid');
    [, $allowed] = $this->memberWithConductor('other');

    $offered = $this->pickerOptions($this->ticketEditedByContributor());
    self::assertContains((int) $allowed->id(), $offered);
    self::assertNotContains((int) $forbidden->id(), $offered);

    $offered = $this->pickerOptions($this->ticketEditedBy($member));
    self::assertContains((int) $allowed->id(), $offered);
    self::assertContains((int) $forbidden->id(), $offered);
  }

  /**
   * The conductor ids the ticket's conductor picker offers.
   *
   * @return array<int>
   *   The offered conductor ids.
   */
  private function pickerOptions(BbTicketInterface $ticket): array {
    $handler = $this->container->get('plugin.manager.entity_reference_selection')->getInstance([
      'target_type' => 'bb_conductor',
      'handler' => 'bb_conductor_by_ticket_project',
      'entity' => $ticket,
    ]);
    self::assertInstanceOf(SelectionInterface::class, $handler);
    return array_map('intval', array_keys($handler->getReferenceableEntities()['bb_conductor'] ?? []));
  }

  /**
   * Loads ticket T-B fresh, with a Contributor of B as the current user.
   */
  private function ticketEditedByContributor(): BbTicketInterface {
    $contributor = $this->createAccount('ticket-contributor-' . $this->randomMachineName(), ['view bb_conductor']);
    $this->addMembership($this->fixture('b', 'bb_workspace'), $contributor, ['contributor']);
    $this->addMembership($this->fixture('b', 'bb_team'), $contributor);
    return $this->ticketEditedBy($contributor);
  }

  /**
   * Loads ticket T-B fresh, with the given account as the current user.
   */
  private function ticketEditedBy(UserInterface $actor): BbTicketInterface {
    $this->setCurrentUser($actor);
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->loadUnchanged($this->fixture('b', 'bb_ticket')->id());
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * The violation messages on conductor_id only.
   *
   * @return array<string>
   *   The messages, in order.
   */
  private function conductorViolations(BbTicketInterface $ticket): array {
    $violations = $ticket->validate()->filterByFields(
      array_diff(array_keys($ticket->getFieldDefinitions()), ['conductor_id']),
    );
    $messages = [];
    foreach ($violations as $violation) {
      $messages[] = (string) $violation->getMessage();
    }
    return $messages;
  }

  /**
   * A Contributor in team B owning an active conductor of project B.
   *
   * The conductor carries $assignment; its own machine carries $machine.
   *
   * @return array{0: \Drupal\user\UserInterface, 1: \Drupal\bb_core\Entity\BbConductorInterface}
   *   The member and the conductor.
   */
  private function memberWithConductor(string $name, string $assignment = 'allow', string $machine = 'forbid'): array {
    $member = $this->createAccount($name);
    $this->addMembership($this->fixture('b', 'bb_workspace'), $member, ['contributor']);
    $this->addMembership($this->fixture('b', 'bb_team'), $member);
    $conductor = $this->createEntity('bb_conductor', [
      'conductor_id' => "node-$name",
      'label' => "node-$name",
      'status' => 'online',
      'project_id' => $this->fixture('b', 'bb_project')->id(),
      'owner_user_id' => $member->id(),
      'assignment' => $assignment,
      'machine' => $this->createEntity('bb_machine', [
        'name' => "machine-$name",
        'host_key' => "host-$name",
        'owner_user_id' => $member->id(),
        'assignment' => $machine,
      ])->id(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    return [$member, $conductor];
  }

  /**
   * A classified ticket of B in `plan`, assigned to the owner's conductor.
   */
  private function createAssignedPlanTicket(): BbTicketInterface {
    $ticket = $this->createEntity('bb_ticket', [
      'identifier' => 'T-ASSIGNED',
      'title' => 'assigned',
      'workflow' => 'bb_work',
      'project_id' => $this->fixture('b', 'bb_project')->id(),
      'conductor_id' => $this->conductor->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    return $ticket;
  }

}
