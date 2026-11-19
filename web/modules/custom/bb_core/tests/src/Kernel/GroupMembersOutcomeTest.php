<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\GroupMembersForm;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Every Members action tells the rebuilt face where focus goes and what to say.
 *
 * The island swap replaces the form, so focus and the result would be lost.
 * The server marks the rebuilt form with `data-members-focus` (an element id)
 * and `data-members-announce` with its priority; `bb_core/members` applies
 * them. Asserted on the response markup the browser receives.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class GroupMembersOutcomeTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine', 'link', 'text',
    'field', 'filter', 'markdown_easy', 'og', 'views', 'ui_patterns', 'island',
    'bb_core',
  ];

  /**
   * The workspace the team belongs to.
   */
  private ContentEntityInterface $workspace;

  /**
   * The team every team case acts on.
   */
  private ContentEntityInterface $team;

  /**
   * The team's members, in roster order.
   *
   * @var array<int, \Drupal\user\UserInterface>
   */
  private array $crew = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('bb_team');
    $this->installEntitySchema('bb_invite');
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    // Uid 1 bypasses every check, so it is created and left unused.
    $this->setUpCurrentUser(['uid' => 1]);

    $this->workspace = $this->entity('bb_workspace', ['name' => 'Acme', 'slug' => 'acme']);
    $this->team = $this->entity('bb_team', ['name' => 'Platform Crew', 'workspace_id' => $this->workspace->id()]);
    foreach (['ada', 'bea', 'cy'] as $name) {
      $account = $this->createUser([], $name);
      self::assertInstanceOf(UserInterface::class, $account);
      $this->addMembership($this->workspace, $account, ['member']);
      $this->addMembership($this->team, $account);
      $this->crew[] = $account;
    }
  }

  /**
   * A role change keeps focus on that row's role trigger and says the result.
   */
  public function testRoleChangeFocusesTheSameRoleTriggerAndAnnouncesIt(): void {
    $this->actAsTeamManager();
    $bea = (int) $this->crew[1]->id();

    $page = $this->submitTeam(['member_role_' . $bea => 'lead']);

    $this->assertOutcome($page, 'members-role-' . $bea, 'bea is now Lead.', 'polite');
    self::assertCount(1, $page->filter('#members-role-' . $bea), 'the focus target exists in the rebuilt face');
    self::assertSame(
      "Change bea's role. Currently Lead.",
      $page->filter('#members-role-' . $bea)->attr('aria-label'),
      'the rebuilt trigger still names the person',
    );
    self::assertSame(
      "bea's role",
      $page->filter('#members-role-' . $bea)->closest('[data-option-picker-label]')?->attr('data-option-picker-label'),
      'the picker script relabels a pick from this, so it must name the person too',
    );
  }

  /**
   * Removing a member focuses the next row's role trigger.
   */
  public function testRemoveFocusesTheNextRowAndAnnouncesIt(): void {
    $this->actAsTeamManager();
    $uids = $this->rosterUids();
    $position = array_search((int) $this->crew[1]->id(), $uids, TRUE);
    self::assertIsInt($position);
    $next = $uids[$position + 1] ?? $uids[$position - 1];

    $page = $this->submitTeam(['confirm_remove_' . $this->crew[1]->id() => (string) $this->crew[1]->id()]);

    $this->assertOutcome($page, 'members-role-' . $next, 'Removed bea.', 'polite');
  }

  /**
   * Removing the last row falls back to the previous row.
   */
  public function testRemovingTheLastRowFocusesThePreviousRow(): void {
    $this->actAsTeamManager();
    $uids = $this->rosterUids();
    $last = end($uids);
    $previous = $uids[count($uids) - 2];

    $page = $this->submitTeam(['confirm_remove_' . $last => (string) $last]);

    $this->assertOutcome($page, 'members-role-' . $previous, NULL, 'polite');
  }

  /**
   * Removing the only member falls back to the add field.
   */
  public function testRemovingTheOnlyMemberFocusesTheAddField(): void {
    $this->actAsTeamManager();
    foreach ($this->rosterUids() as $uid) {
      if ($uid !== (int) $this->crew[0]->id()) {
        $this->container->get('bb_core.membership_writer')->remove($this->team, $uid);
      }
    }

    $page = $this->submitTeam(['confirm_remove_' . $this->crew[0]->id() => (string) $this->crew[0]->id()]);

    $this->assertOutcome($page, 'members-add', 'Removed ada.', 'polite');
    self::assertCount(1, $page->filter('#members-add'), 'the add field carries the id');
  }

  /**
   * Adding someone focuses the new row's role trigger.
   */
  public function testAddFocusesTheNewRowsRoleTriggerAndAnnouncesIt(): void {
    $dee = $this->createUser(['view bb_team', 'update any bb_team'], 'dee');
    self::assertInstanceOf(UserInterface::class, $dee);
    $this->addMembership($this->workspace, $dee, ['member']);
    $this->setCurrentUser($dee);
    $this->enterRoute($this->team);

    $page = $this->submitTeam([
      'account' => sprintf('dee (%d)', (int) $dee->id()),
      'add_member' => 'Add member',
    ]);

    $this->assertOutcome($page, 'members-role-' . $dee->id(), 'Added dee as Member.', 'polite');
  }

  /**
   * A refused change focuses the refused control and is announced assertively.
   */
  public function testARefusedChangeFocusesTheControlAndAnnouncesTheErrorAssertively(): void {
    self::assertInstanceOf(EntityOwnerInterface::class, $this->workspace);
    $owner_uid = (int) $this->workspace->getOwnerId();
    $lead = $this->createUser(['view bb_workspace', 'update any bb_workspace'], 'lena');
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    $this->enterRoute($this->workspace);

    $form_state = new FormState();
    $form_state->setProgrammed();
    $form_state->setUserInput([
      'form_id' => $this->formId(),
      'remove_member_' . $owner_uid => (string) $owner_uid,
      'apply' => 'Apply',
    ]);
    $form_state->addBuildInfo('args', [['island_id' => 'members', 'host_id' => 'workspace']]);
    $form = $this->container->get('form_builder')->buildForm(GroupMembersForm::class, $form_state);

    self::assertNotSame([], $form_state->getErrors(), 'the owner removal is refused');
    self::assertSame('members-remove-' . $owner_uid, $form['#attributes']['data-members-focus'] ?? NULL);
    self::assertSame('The owner of this workspace cannot be removed or demoted.', (string) ($form['#attributes']['data-members-announce'] ?? ''));
    self::assertSame('assertive', $form['#attributes']['data-members-announce-priority'] ?? NULL);
  }

  /**
   * The last admin cannot leave: the confirming press is refused as well.
   */
  public function testTheLastAdminCannotLeave(): void {
    $lead = $this->createUser(['view bb_workspace', 'update any bb_workspace'], 'lena');
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    $this->enterRoute($this->workspace);
    $uid = (int) $lead->id();
    // The fixture's owner holds the lead role too; strip it so lena is the last.
    $owner = $this->container->get('bb_core.membership_writer')->membershipOf($this->workspace, 1);
    self::assertNotNull($owner);
    $owner->setRoles([])->save();

    $form = $this->buildWorkspaceWith(['confirm_remove_' . $uid => (string) $uid]);

    self::assertSame('members-remove-' . $uid, $form['#attributes']['data-members-focus'] ?? NULL);
    self::assertSame('The last admin of this workspace cannot be removed or demoted.', (string) ($form['#attributes']['data-members-announce'] ?? ''));
    self::assertNotNull($this->container->get('bb_core.membership_writer')->membershipOf($this->workspace, $uid), 'still a member');
  }

  /**
   * A confirmed leave sends the actor away with a message instead of rebuilding.
   */
  public function testAConfirmedLeaveLoadsAnotherPage(): void {
    $lead = $this->createUser(['view bb_workspace', 'update any bb_workspace'], 'lena');
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    $this->enterRoute($this->workspace);
    $uid = (int) $lead->id();

    $form_state = new FormState();
    $form_state->setValues(['confirm_remove_' . $uid => (string) $uid]);
    $this->container->get('form_builder')->submitForm(
      GroupMembersForm::class,
      $form_state,
      ['island_id' => 'members', 'host_id' => 'workspace'],
    );

    self::assertSame([], array_map('strval', $form_state->getErrors()));
    self::assertNull($this->container->get('bb_core.membership_writer')->membershipOf($this->workspace, $uid), 'lena left');
    $response = $form_state->getResponse();
    self::assertInstanceOf(Response::class, $response);
    self::assertTrue($response->headers->has('HX-Location') || $response->headers->has('HX-Redirect'), 'the answer is a page load');
    self::assertSame(['You left Acme.'], array_map('strval', $this->container->get('messenger')->messagesByType('status')));
  }

  /**
   * The acting manager's own row offers Leave rather than Remove.
   */
  public function testTheOwnRowOffersLeave(): void {
    $lead = $this->createUser(['view bb_workspace', 'update any bb_workspace'], 'lena');
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    $this->enterRoute($this->workspace);
    $form = $this->container->get('form_builder')->getForm(
      GroupMembersForm::class,
      ['island_id' => 'members', 'host_id' => 'workspace'],
    );
    $page = new Crawler((string) $this->container->get('renderer')->renderInIsolation($form));

    self::assertStringStartsWith('Leave Acme.', (string) $page->filter('#members-remove-' . $lead->id())->attr('aria-label'));
    self::assertStringStartsWith('Remove ada from Acme.', (string) $page->filter('#members-remove-' . $this->crew[0]->id())->attr('aria-label'));
  }

  /**
   * Builds the workspace face with one pressed key, as a refused POST does.
   *
   * @param array<string, string> $input
   *   The pressed key.
   *
   * @return array<string, mixed>
   *   The form answered back.
   */
  private function buildWorkspaceWith(array $input): array {
    $form_state = new FormState();
    $form_state->setProgrammed();
    $form_state->setUserInput(['form_id' => $this->formId(), 'apply' => 'Apply'] + $input);
    $form_state->addBuildInfo('args', [['island_id' => 'members', 'host_id' => 'workspace']]);
    $form = $this->container->get('form_builder')->buildForm(GroupMembersForm::class, $form_state);
    self::assertNotSame([], $form_state->getErrors(), 'the press is refused');
    return $form;
  }

  /**
   * A plain render carries no outcome, so a page load moves nothing.
   */
  public function testAPlainRenderCarriesNoOutcome(): void {
    $this->actAsTeamManager();
    $form = $this->container->get('form_builder')->getForm(
      GroupMembersForm::class,
      ['island_id' => 'members', 'host_id' => 'team'],
    );
    $page = new Crawler((string) $this->container->get('renderer')->renderInIsolation($form));

    self::assertCount(0, $page->filter('[data-members-focus]'));
    self::assertContains('bb_core/members', $form['#attached']['library'] ?? [], 'the behavior is attached');
  }

  /**
   * Asserts the rebuilt form's outcome attributes.
   */
  private function assertOutcome(Crawler $page, string $focus, ?string $announce, string $priority): void {
    $form = $page->filter('form[data-members-focus]');
    self::assertCount(1, $form, 'the rebuilt form carries an outcome');
    self::assertSame($focus, $form->attr('data-members-focus'));
    if ($announce !== NULL) {
      self::assertSame($announce, $form->attr('data-members-announce'));
    }
    self::assertSame($priority, $form->attr('data-members-announce-priority'));
  }

  /**
   * Becomes an account that may change the team's crew, on its route.
   */
  private function actAsTeamManager(): void {
    $manager = $this->createUser(['view bb_team', 'update any bb_team']);
    self::assertInstanceOf(UserInterface::class, $manager);
    $this->setCurrentUser($manager);
    $this->enterRoute($this->team);
  }

  /**
   * Submits the team face as the island POST does; returns the response DOM.
   *
   * @param array<string, string> $values
   *   The submitted keys.
   */
  private function submitTeam(array $values): Crawler {
    $form_state = new FormState();
    $form_state->setValues($values);
    $this->container->get('form_builder')->submitForm(
      GroupMembersForm::class,
      $form_state,
      ['island_id' => 'members', 'host_id' => 'team'],
    );
    self::assertSame([], array_map('strval', $form_state->getErrors()), 'the submit was accepted');
    $response = $form_state->getResponse();
    self::assertInstanceOf(Response::class, $response, 'the submit answered with the island fragment');
    return new Crawler((string) $response->getContent());
  }

  /**
   * The team's member uids in roster order.
   *
   * @return array<int, int>
   *   The uids.
   */
  private function rosterUids(): array {
    return array_map(
      static fn ($membership): int => (int) $membership->getOwnerId(),
      array_values($this->container->get('bb_core.membership_writer')->memberships($this->team)),
    );
  }

  /**
   * The members form's id.
   */
  private function formId(): string {
    return $this->container->get('class_resolver')
      ->getInstanceFromDefinition(GroupMembersForm::class)
      ->getFormId();
  }

  /**
   * A saved entity of one of the fixture types.
   *
   * @param string $entity_type_id
   *   The entity type id.
   * @param array<string, mixed> $values
   *   The field values.
   */
  private function entity(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Makes one group's Members route the current one.
   */
  private function enterRoute(ContentEntityInterface $group): void {
    $route_name = sprintf('bb_core.%s.members', $group->getEntityTypeId());
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $request = Request::create('/group-members-outcome-test', 'POST');
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('bb_workspace', $this->workspace);
    $request->attributes->set($group->getEntityTypeId(), $group);
    $this->container->get('request_stack')->push($request);
  }

}
