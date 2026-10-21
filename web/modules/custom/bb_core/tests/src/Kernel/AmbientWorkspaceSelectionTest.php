<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Plugin\PluginInspectionInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityReferenceSelection\SelectionInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Plugin\EntityReferenceSelection\ActiveWorkspaceSelectionBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The two selection plugins narrow the offer to the active workspace (V3).
 *
 * BB-351 D5. Every narrowing actor here is a member of BOTH workspaces on
 * purpose: the read scope already bounds an access-checked query to the
 * account's own workspaces (spec Fact 11), so an actor with a single membership
 * would produce a green assertion whether or not the plugin added a condition.
 * Only an actor who may READ both sides can show that the plugin is what
 * narrows the offer — which holds for the `validateReferenceableEntities()`
 * cases just as much as for the `getReferenceableEntities()` ones, since both
 * run the same `buildEntityQuery()`.
 *
 * The plugins take the active workspace from two places and both are covered
 * below: the `selection_settings` a form hands over (which is what reaches the
 * autocomplete's own request) and, failing that, the add-form route.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class AmbientWorkspaceSelectionTest extends KernelTestBase {

  use AmbientWorkspaceTestTrait;

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
    $this->installAmbientWorkspaceWorld();
  }

  /**
   * Under an add-form route the group offer is that workspace's groups only.
   */
  public function testGroupSelectionOffersOnlyTheActiveWorkspacesGroups(): void {
    $actor = $this->readerOfBothWorkspaces(['view bb_group']);
    $this->enterAddFormRouteWithWorkspace($this->fixture('a', 'bb_workspace'), 'bb_project');
    $this->switchTo($actor);

    $ids = $this->referenceableIds('bb_group', 'bb_group_in_active_workspace');

    self::assertContains((int) $this->fixture('a', 'bb_group')->id(), $ids);
    self::assertNotContains((int) $this->fixture('b', 'bb_group')->id(), $ids);
  }

  /**
   * The selection_settings source narrows the offer with no route at all.
   *
   * This is what makes the autocomplete request work. That request is its own
   * HTTP round trip and carries no `{bb_workspace}` — the form hands the
   * resolved workspace over in `#selection_settings`, core hashes those into
   * the endpoint URL, and the endpoint rebuilds the handler from them. So the
   * handler has to narrow on its CONFIGURATION, not only on the route: the
   * instance below is built exactly as the autocomplete controller builds it.
   */
  public function testGroupSelectionNarrowsOnSelectionSettingsWithoutRoute(): void {
    $actor = $this->readerOfBothWorkspaces(['view bb_group']);
    $this->switchTo($actor);

    $ids = $this->referenceableIds(
      'bb_group',
      'bb_group_in_active_workspace',
      [ActiveWorkspaceSelectionBase::ACTIVE_WORKSPACE_SETTING => (int) $this->fixture('a', 'bb_workspace')->id()],
    );

    self::assertContains((int) $this->fixture('a', 'bb_group')->id(), $ids);
    self::assertNotContains((int) $this->fixture('b', 'bb_group')->id(), $ids);
  }

  /**
   * The same carrier on the project plugin (bb_ticket.project_id).
   */
  public function testProjectSelectionNarrowsOnSelectionSettingsWithoutRoute(): void {
    $actor = $this->readerOfBothWorkspaces(['view bb_project'], 'lead');
    $this->switchTo($actor);

    $ids = $this->referenceableIds(
      'bb_project',
      'bb_project_in_active_workspace',
      [ActiveWorkspaceSelectionBase::ACTIVE_WORKSPACE_SETTING => (int) $this->fixture('a', 'bb_workspace')->id()],
    );

    self::assertContains((int) $this->fixture('a', 'bb_project')->id(), $ids);
    self::assertNotContains((int) $this->fixture('b', 'bb_project')->id(), $ids);
  }

  /**
   * Under an add-form route the project offer is that workspace's only.
   */
  public function testProjectSelectionOffersOnlyTheActiveWorkspacesProjects(): void {
    $actor = $this->readerOfBothWorkspaces(['view bb_project'], 'lead');
    $this->enterAddFormRouteWithWorkspace($this->fixture('a', 'bb_workspace'), 'bb_ticket');
    $this->switchTo($actor);

    $ids = $this->referenceableIds('bb_project', 'bb_project_in_active_workspace');

    self::assertContains((int) $this->fixture('a', 'bb_project')->id(), $ids);
    self::assertNotContains((int) $this->fixture('b', 'bb_project')->id(), $ids);
  }

  /**
   * Without an active workspace the offer is the read scope, not the world.
   *
   * Off any add-form route and with no selection_settings, the chain resolves
   * SOURCE_NONE and the plugin adds no condition. The offer must then be
   * exactly what the account may read — both sides — while a third workspace it
   * has no membership in stays absent. That absence is what proves the query
   * kept its access check (D5, Fact 11).
   */
  public function testWithoutAnActiveWorkspaceTheOfferIsTheReadScope(): void {
    $foreign_owner = $this->createAccount('foreign-owner');
    $foreign = $this->createEntity('bb_workspace', [
      'name' => 'workspace-third',
      'owner_user_id' => $foreign_owner->id(),
    ]);
    $foreign_group = $this->createEntity('bb_group', [
      'name' => 'group-third',
      'workspace_id' => $foreign->id(),
      'owner_user_id' => $foreign_owner->id(),
    ]);
    $actor = $this->readerOfBothWorkspaces(['view bb_group']);
    $this->switchTo($actor);

    $ids = $this->referenceableIds('bb_group', 'bb_group_in_active_workspace');

    self::assertContains((int) $this->fixture('a', 'bb_group')->id(), $ids);
    self::assertContains((int) $this->fixture('b', 'bb_group')->id(), $ids);
    self::assertNotContains((int) $foreign_group->id(), $ids);
  }

  /**
   * ValidReference validates a submitted target, not only an offered one.
   *
   * Calling getReferenceableEntities() cannot show this regression: core's
   * ValidReference constraint calls validateReferenceableEntities(), and that
   * is the method the narrowing plugin actually gates writes through. An
   * `administer bakers` account whose only membership is workspace A must still
   * have workspace B's group accepted — the same escape hatch the constraint's
   * guard B and the form trait already honour.
   */
  public function testGroupSelectionValidatesForeignGroupForBypassedAdmin(): void {
    $actor = $this->createAccount('sel-admin-a', ['administer bakers']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $actor, ['member']);
    $this->switchTo($actor);

    $foreign_id = (int) $this->fixture('b', 'bb_group')->id();
    $validated = $this->validatedIds('bb_group', 'bb_group_in_active_workspace', [$foreign_id]);

    self::assertSame([$foreign_id], $validated);
  }

  /**
   * The same escape hatch on the project plugin (bb_ticket.project_id).
   */
  public function testProjectSelectionValidatesForeignProjectForBypassedAdmin(): void {
    $actor = $this->createAccount('sel-admin-b', ['administer bakers']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $actor, ['member']);
    $this->switchTo($actor);

    $foreign_id = (int) $this->fixture('b', 'bb_project')->id();
    $validated = $this->validatedIds('bb_project', 'bb_project_in_active_workspace', [$foreign_id]);

    self::assertSame([$foreign_id], $validated);
  }

  /**
   * The exact shape of the e2e fixture that went red: a workspace-less group.
   *
   * The fixture at tests/playwright/steps/project-repo.steps.ts creates its
   * group with no `workspace_id` at all. An `administer bakers` account
   * resolving an active workspace from its own single membership must still
   * be able to save a project referencing such a group.
   */
  public function testGroupSelectionValidatesWorkspaceLessGroupForBypassedAdmin(): void {
    $actor = $this->createAccount('sel-admin-c', ['administer bakers']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $actor, ['member']);
    $this->switchTo($actor);

    $group = $this->createEntity('bb_group', [
      'name' => 'group-no-workspace',
      'owner_user_id' => $this->worldOwner->id(),
    ]);

    $validated = $this->validatedIds('bb_group', 'bb_group_in_active_workspace', [(int) $group->id()]);

    self::assertSame([(int) $group->id()], $validated);
  }

  /**
   * The bypass fix must not widen the offer for an ordinary account.
   *
   * The actor reads BOTH workspaces, which is what makes this bite. With a
   * single-membership actor the read scope alone already returns nothing for
   * the foreign id, so the assertion would stay green however the plugin's
   * narrowing were broken — it would measure the read scope, not this plugin.
   */
  public function testGroupSelectionRejectsForeignGroupForNonBypassedAccount(): void {
    $actor = $this->readerOfBothWorkspaces(['view bb_group']);
    $this->enterAddFormRouteWithWorkspace($this->fixture('a', 'bb_workspace'), 'bb_project');
    $this->switchTo($actor);

    $foreign_id = (int) $this->fixture('b', 'bb_group')->id();
    $validated = $this->validatedIds('bb_group', 'bb_group_in_active_workspace', [$foreign_id]);

    self::assertSame([], $validated);
  }

  /**
   * Same non-widening assertion on the project plugin, same reader-of-both.
   */
  public function testProjectSelectionRejectsForeignProjectForNonBypassedAccount(): void {
    $actor = $this->readerOfBothWorkspaces(['view bb_project'], 'lead');
    $this->enterAddFormRouteWithWorkspace($this->fixture('a', 'bb_workspace'), 'bb_ticket');
    $this->switchTo($actor);

    $foreign_id = (int) $this->fixture('b', 'bb_project')->id();
    $validated = $this->validatedIds('bb_project', 'bb_project_in_active_workspace', [$foreign_id]);

    self::assertSame([], $validated);
  }

  /**
   * The Assignee offer is the TICKET's workspace, not every workspace.
   *
   * BB-414's second review gate. `assignee_user_id` declared `target_type:
   * user` and no handler at all, so core's `UserSelection` enumerated every
   * account on the instance and `TicketInspectorRows` rendered the first fifty
   * of them — names and all — into the detail screen's markup, whichever
   * workspace they belonged to.
   *
   * The handler is built exactly the way the rail builds it: off the FIELD
   * DEFINITION with the ticket as the referring entity
   * (`getSelectionHandler($definition, $ticket)`), so this test fails if either
   * half regresses — the field forgetting its `handler` setting, or the plugin
   * forgetting to narrow.
   *
   * The actor is a member of BOTH workspaces on purpose, for the reason this
   * class's docblock gives: `user` is a narrowed type too
   * (WorkspaceReadScopeSubscriber maps it to `peopleIds()`), so a
   * single-membership actor would produce a green assertion whether or not the
   * plugin added a condition.
   */
  public function testAssigneeSelectionOffersOnlyTheTicketWorkspacesAccounts(): void {
    $actor = $this->membersOfBothSidesReadableBy(['access user profiles']);
    $this->switchTo($actor);

    $ids = $this->assigneeIds($this->fixture('a', 'bb_ticket'));

    self::assertContains((int) $this->member('a')->id(), $ids);
    self::assertNotContains((int) $this->member('b')->id(), $ids);
  }

  /**
   * A foreign-workspace account is REFUSED, not merely left unoffered.
   *
   * `getReferenceableEntities()` only shows what a widget would have drawn.
   * Core's ValidReference constraint calls `validateReferenceableEntities()`,
   * and that is the method a submitted `assignee_user_id` is actually gated
   * through — so the write half needs its own assertion, exactly as the group
   * and project plugins above have one.
   */
  public function testAssigneeSelectionRejectsForeignWorkspaceAccount(): void {
    $actor = $this->membersOfBothSidesReadableBy(['access user profiles']);
    $this->switchTo($actor);

    $foreign_id = (int) $this->member('b')->id();
    $validated = $this->validatedAssigneeIds(
      $this->fixture('a', 'bb_ticket'),
      [$foreign_id],
    );

    self::assertSame([], $validated);
  }

  /**
   * A `administer users` account keeps the cross-workspace write open.
   *
   * The same escape hatch the group and project plugins carry, asked the same
   * way: as a permission on the TARGET type this plugin queries. For `user`
   * that permission is `administer users`, not `administer bakers` — and which
   * one it is was MEASURED rather than chosen. With `administer bakers` alone
   * this assertion fails even with no narrowing plugin in the tree at all,
   * because the handler's query keeps its access check and an account without
   * `access user profiles` may not read a foreign account whatever this plugin
   * does. `administer users` is therefore the only permission that can make the
   * cross-workspace write reachable, so it is the only one worth honouring.
   *
   * Unlike the two assertions above this one is green BEFORE the fix — an
   * unnarrowed handler validates everything. Its job is the other direction: it
   * goes red the moment the new plugin narrows without an escape hatch, which
   * is exactly how it was used while this plugin was written.
   */
  public function testAssigneeSelectionValidatesForeignAccountForBypassedAdmin(): void {
    $actor = $this->createAccount('sel-admin-assignee', ['administer bakers', 'administer users']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $actor, ['member']);
    $this->addMembership($this->fixture('b', 'bb_workspace'), $this->member('b'), ['member']);
    $this->switchTo($actor);

    $foreign_id = (int) $this->member('b')->id();
    $validated = $this->validatedAssigneeIds(
      $this->fixture('a', 'bb_ticket'),
      [$foreign_id],
    );

    self::assertSame([$foreign_id], $validated);
  }

  /**
   * Reviewers reuse the Assignee workspace handler and the same offer.
   */
  public function testReviewersSelectionOffersOnlyTheTicketWorkspacesAccounts(): void {
    $actor = $this->membersOfBothSidesReadableBy(['access user profiles']);
    $this->switchTo($actor);
    $ticket = $this->fixture('a', 'bb_ticket');

    self::assertSame(
      $this->assigneeHandler($ticket)->getPluginId(),
      $this->reviewersHandler($ticket)->getPluginId(),
    );
    $ids = $this->reviewerIds($ticket);

    self::assertContains((int) $this->member('a')->id(), $ids);
    self::assertNotContains((int) $this->member('b')->id(), $ids);
    self::assertNotContains(0, $ids);
  }

  /**
   * A foreign-workspace account is refused as a reviewers submit.
   */
  public function testReviewersSelectionRejectsForeignWorkspaceAccount(): void {
    $actor = $this->membersOfBothSidesReadableBy(['access user profiles']);
    $this->switchTo($actor);

    $foreign_id = (int) $this->member('b')->id();
    $validated = $this->validatedReviewerIds(
      $this->fixture('a', 'bb_ticket'),
      [$foreign_id],
    );

    self::assertSame([], $validated);
  }

  /**
   * Anonymous and missing accounts are refused as reviewers.
   */
  public function testReviewersSelectionRejectsAnonymousAndNonexistent(): void {
    $actor = $this->membersOfBothSidesReadableBy(['access user profiles']);
    $this->switchTo($actor);
    $ticket = $this->fixture('a', 'bb_ticket');

    self::assertSame([], $this->validatedReviewerIds($ticket, [0]));
    self::assertSame([], $this->validatedReviewerIds($ticket, [999999]));
  }

  /**
   * The Members add field offers only that workspace's accounts.
   *
   * `GroupMembersForm` used core's `UserSelection` and enumerated every
   * account. A team add must pick from the parent workspace, and the
   * handler is what makes the autocomplete request (no route workspace)
   * still narrow.
   */
  public function testWorkspaceMembersSelectionOffersOnlyThatWorkspacesAccounts(): void {
    $actor = $this->membersOfBothSidesReadableBy(['access user profiles']);
    $this->switchTo($actor);

    $ids = $this->referenceableIds(
      'user',
      'bb_workspace_members',
      [ActiveWorkspaceSelectionBase::ACTIVE_WORKSPACE_SETTING => (int) $this->fixture('a', 'bb_workspace')->id()],
    );

    self::assertContains((int) $this->member('a')->id(), $ids);
    self::assertNotContains((int) $this->member('b')->id(), $ids);
  }

  /**
   * A foreign-workspace account is refused as a team-member submit.
   */
  public function testWorkspaceMembersSelectionRejectsForeignWorkspaceAccount(): void {
    $actor = $this->membersOfBothSidesReadableBy(['access user profiles']);
    $this->switchTo($actor);

    $foreign_id = (int) $this->member('b')->id();
    $instance = $this->container->get('plugin.manager.entity_reference_selection')
      ->getInstance([
        'target_type' => 'user',
        'handler' => 'bb_workspace_members',
        ActiveWorkspaceSelectionBase::ACTIVE_WORKSPACE_SETTING => (int) $this->fixture('a', 'bb_workspace')->id(),
      ]);
    self::assertInstanceOf(SelectionInterface::class, $instance);
    $validated = array_map('intval', array_values($instance->validateReferenceableEntities([$foreign_id])));

    self::assertSame([], $validated);
  }

  /**
   * With no workspace id the Members handler offers nobody, not everybody.
   */
  public function testWorkspaceMembersSelectionOffersNobodyWhenWorkspaceIsMissing(): void {
    $actor = $this->membersOfBothSidesReadableBy(['access user profiles']);
    $this->switchTo($actor);

    $ids = $this->referenceableIds('user', 'bb_workspace_members');

    self::assertNotContains((int) $this->member('a')->id(), $ids);
    self::assertNotContains((int) $this->member('b')->id(), $ids);
  }

  /**
   * Both sides' member accounts, and an actor entitled to read both.
   *
   * The two memberships are what put `member-a` and `member-b` into any
   * workspace at all — `buildWorkspaceSide()` deliberately creates the accounts
   * without one — and the actor's two make both of them readable.
   *
   * @param array<string> $permissions
   *   The site permissions the actor holds.
   *
   * @return \Drupal\user\UserInterface
   *   The actor.
   */
  private function membersOfBothSidesReadableBy(array $permissions): UserInterface {
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->member('a'), ['member']);
    $this->addMembership($this->fixture('b', 'bb_workspace'), $this->member('b'), ['member']);
    return $this->readerOfBothWorkspaces($permissions);
  }

  /**
   * The account ids the ticket's own Assignee field offers.
   *
   * Built through `getSelectionHandler($definition, $ticket)` rather than from
   * a plugin id, because that is the call
   * `BbTicketPropertyForm::propertyOptions()` makes. The field's declaration
   * is half of what is under test.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $ticket
   *   The ticket whose Assignee field to ask.
   *
   * @return array<int>
   *   The offered user ids, as integers.
   */
  private function assigneeIds(ContentEntityInterface $ticket): array {
    $referenceable = $this->assigneeHandler($ticket)->getReferenceableEntities();
    return array_map('intval', array_keys($referenceable['user'] ?? []));
  }

  /**
   * The account ids the ticket's Assignee field ACCEPTS from a submit.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $ticket
   *   The ticket whose Assignee field to ask.
   * @param array<int> $ids
   *   The candidate user ids.
   *
   * @return array<int>
   *   The accepted user ids, as integers.
   */
  private function validatedAssigneeIds(ContentEntityInterface $ticket, array $ids): array {
    $validated = $this->assigneeHandler($ticket)->validateReferenceableEntities($ids);
    return array_map('intval', array_values($validated));
  }

  /**
   * The selection handler the ticket's Assignee field resolves to.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $ticket
   *   The referring ticket.
   *
   * @return \Drupal\Core\Entity\EntityReferenceSelection\SelectionInterface&\Drupal\Component\Plugin\PluginInspectionInterface
   *   The handler.
   */
  private function assigneeHandler(ContentEntityInterface $ticket): SelectionInterface&PluginInspectionInterface {
    return $this->userReferenceHandler($ticket, 'assignee_user_id');
  }

  /**
   * The account ids the ticket's Reviewers field offers.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $ticket
   *   The ticket whose Reviewers field to ask.
   *
   * @return array<int>
   *   The offered user ids, as integers.
   */
  private function reviewerIds(ContentEntityInterface $ticket): array {
    $referenceable = $this->reviewersHandler($ticket)->getReferenceableEntities();
    return array_map('intval', array_keys($referenceable['user'] ?? []));
  }

  /**
   * The account ids the ticket's Reviewers field ACCEPTS from a submit.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $ticket
   *   The ticket whose Reviewers field to ask.
   * @param array<int> $ids
   *   The candidate user ids.
   *
   * @return array<int>
   *   The accepted user ids, as integers.
   */
  private function validatedReviewerIds(ContentEntityInterface $ticket, array $ids): array {
    $validated = $this->reviewersHandler($ticket)->validateReferenceableEntities($ids);
    return array_map('intval', array_values($validated));
  }

  /**
   * The selection handler the ticket's Reviewers field resolves to.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $ticket
   *   The referring ticket.
   *
   * @return \Drupal\Core\Entity\EntityReferenceSelection\SelectionInterface&\Drupal\Component\Plugin\PluginInspectionInterface
   *   The handler.
   */
  private function reviewersHandler(ContentEntityInterface $ticket): SelectionInterface&PluginInspectionInterface {
    return $this->userReferenceHandler($ticket, 'reviewers');
  }

  /**
   * The selection handler a ticket user-reference field resolves to.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $ticket
   *   The referring ticket.
   * @param string $field_name
   *   The field whose handler to resolve.
   *
   * @return \Drupal\Core\Entity\EntityReferenceSelection\SelectionInterface&\Drupal\Component\Plugin\PluginInspectionInterface
   *   The handler.
   */
  private function userReferenceHandler(ContentEntityInterface $ticket, string $field_name): SelectionInterface&PluginInspectionInterface {
    $definition = $ticket->getFieldDefinition($field_name);
    self::assertInstanceOf(FieldDefinitionInterface::class, $definition);
    $handler = $this->container->get('plugin.manager.entity_reference_selection')
      ->getSelectionHandler($definition, $ticket);
    self::assertInstanceOf(SelectionInterface::class, $handler);
    self::assertInstanceOf(PluginInspectionInterface::class, $handler);
    return $handler;
  }

  /**
   * Creates an account that may READ both workspaces' rows.
   *
   * @param array<string> $permissions
   *   The site permissions the account holds.
   * @param string $role_name
   *   The OG role to attach on both memberships. `member` is enough for groups
   *   and teams; projects need a see-all role, because plain workspace
   *   membership grants no project ids at all (BB-318 D11).
   *
   * @return \Drupal\user\UserInterface
   *   The account.
   */
  private function readerOfBothWorkspaces(array $permissions, string $role_name = 'member'): UserInterface {
    $account = $this->createAccount('sel-both-' . $role_name, $permissions);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, [$role_name]);
    $this->addMembership($this->fixture('b', 'bb_workspace'), $account, [$role_name]);
    return $account;
  }

  /**
   * Switches the current user for the rest of the test method.
   *
   * @param \Drupal\user\UserInterface $account
   *   The account to act as.
   */
  private function switchTo(UserInterface $account): void {
    $this->container->get('account_switcher')->switchTo($account);
  }

  /**
   * Returns the ids a selection handler offers for a target type.
   *
   * @param string $target_type
   *   The referenced entity type id.
   * @param string $handler
   *   The selection plugin id.
   * @param array<string, mixed> $settings
   *   Extra handler configuration, the way core's autocomplete controller
   *   rebuilds a handler from the `#selection_settings` a widget declared.
   *
   * @return array<int>
   *   The referenceable entity ids, as integers.
   */
  private function referenceableIds(string $target_type, string $handler, array $settings = []): array {
    $instance = $this->container->get('plugin.manager.entity_reference_selection')
      ->getInstance($settings + ['target_type' => $target_type, 'handler' => $handler]);
    self::assertInstanceOf(SelectionInterface::class, $instance);
    $referenceable = $instance->getReferenceableEntities();
    return array_map('intval', array_keys($referenceable[$target_type] ?? []));
  }

  /**
   * Returns the ids validateReferenceableEntities() accepts, as integers.
   *
   * This is the method core's ValidReference constraint actually calls to
   * validate a submitted target — not getReferenceableEntities(), which only
   * shows what a form widget would have offered. A narrowing bug that gates
   * writes lives in this method, so a regression test has to call it too.
   *
   * @param string $target_type
   *   The referenced entity type id.
   * @param string $handler
   *   The selection plugin id.
   * @param array<int> $ids
   *   The candidate ids to validate.
   *
   * @return array<int>
   *   The accepted ids, as integers.
   */
  private function validatedIds(string $target_type, string $handler, array $ids): array {
    $instance = $this->container->get('plugin.manager.entity_reference_selection')
      ->getInstance(['target_type' => $target_type, 'handler' => $handler]);
    self::assertInstanceOf(SelectionInterface::class, $instance);
    $validated = $instance->validateReferenceableEntities($ids);
    return array_map('intval', array_values($validated));
  }

}
