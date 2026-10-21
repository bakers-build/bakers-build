<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Form\GroupMembersForm;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Removing a member is a write and is gated as one (BB-419 D7).
 *
 * FOUR CASES. Two of them are what this control adds beyond what
 * `TeamMemberAddAccessTest` already proves about the surface: that the delete
 * happens, and that the refusal comes from the SUBMIT rather than from the
 * build. Everything else about the island — the fragment response, the
 * cacheability, the uniform refusal — is that class's coverage and is not
 * re-asserted here, and the control's ACCESSIBLE NAME moved to
 * `GroupMembersListTest`, which renders the face: the sentence is markup now,
 * because the control is a component the form renders rather than a form
 * element carrying an attribute.
 *
 * THE OTHER TWO ARE THE ROW SELECTION, and they exist because the first three
 * shipped a control that removed the WRONG member and every one of them stayed
 * green. The fixture then held ONE member and the submit was handed its uid
 * directly, so "which row" was never a question the test could get wrong. It is
 * the only question this control actually has to answer:
 *
 *   Every row used to render its own INSTANCE of a per-row form, and every
 *   instance had the same form id, so every row's POST body was byte-identical
 *   — `form_id`, `op=Remove`, `form_token`. FormBuilder decided input
 *   processing purely on `$input['form_id'] == $form_id`, and IslandFormBase
 *   never calls setCached(), so the form_build_id path could not disambiguate
 *   either. The FIRST row the list rendered therefore processed every POST and
 *   threw its EnforcedResponseException before any later row was built.
 *   Pressing Remove beside member B deleted whoever happened to be in row 1 —
 *   and the view behind it had `sorts: {}`, so "row 1" was unspecified database
 *   order.
 *
 * BB-435 REMOVED THE DEFECT CLASS RATHER THAN THE DEFECT. There is now ONE
 * form for the whole face, so there are no competing instances to pick the
 * wrong one of: each item's control carries its own request KEY
 * (`remove_member_<uid>`), and the key is what names the member. That is
 * strictly stronger than the previous fix, which read a hidden value from the
 * request instead of from the build args — a correct answer to a question that
 * no longer gets asked. The two identity cases are kept anyway, because "the
 * member the POST names is the member that goes" is the property rather than
 * the mechanism, and the next mechanism has to satisfy it too.
 *
 * SO THE FIXTURE HOLDS TWO MEMBERS AND THE ASSERTIONS ARE ON IDENTITY, NEVER ON
 * A COUNT. A count is exactly what the browser scenario asserted, and removing
 * the wrong member satisfies a count as perfectly as removing the right one.
 *
 * THE REFUSAL IS MEASURED AT THE SUBMIT ON PURPOSE. A remove control that is
 * merely not rendered is not a gate: the POST is reachable without the page
 * ever having been drawn, so an account that never saw the button can still
 * press it. This is the same shape as the defect BB-396's review found in the
 * add form, and it is asserted the same way so it cannot come back.
 *
 * IT IS NOT CONFIRMED, and that is a decision rather than an omission. A
 * confirm step is a second page, and the whole reason this face is an island is
 * that a mutation re-renders exactly the thing it changed. What stands in for
 * the confirmation is the control NAMING its effect — which is the one place
 * AC 6 exempts a per-group-type difference.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class GroupMemberRemoveTest extends KernelTestBase {

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
   * The workspace the team below belongs to.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The team whose crew every case here tries to change.
   */
  private BbTeamInterface $team;

  /**
   * The account already in that crew, and the one being removed.
   */
  private UserInterface $crewMember;

  /**
   * A SECOND account in the same crew, so a row can be picked wrongly.
   *
   * Without it there is only one row and every wrong answer looks like the
   * right one — which is precisely how the row-selection defect shipped green.
   */
  private UserInterface $otherCrewMember;

  /**
   * A member of a DIFFERENT team, for the group-scoping case.
   *
   * A uid arriving in the POST names an account, not a membership. Proving that
   * it cannot reach outside this group needs an account that really does hold a
   * membership somewhere else; an account with no membership at all would pass
   * the same assertion while proving only that nothing matched.
   */
  private UserInterface $strangerInAnotherTeam;

  /**
   * The other team, which must be left alone.
   */
  private BbTeamInterface $otherTeam;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_team');
    $this->installConfig(['system', 'user', 'og']);
    // A recipe registers this in `actions:`, which run AFTER `config:`. A
    // kernel test has no recipe, so it registers the group itself; without it
    // OgMembership::save() throws "not an OG group" and a refusal could not be
    // told apart from a storage failure.
    Og::addGroup('bb_team', 'bb_team');
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

    // Uid 1 holds every permission and could not be refused, so the root
    // account is created and then left unused.
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

    $member = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $member);
    $this->crewMember = $member;
    Og::createMembership($team, $member)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $other = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $other);
    $this->otherCrewMember = $other;
    Og::createMembership($team, $other)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $other_team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 'Design Crew', 'workspace_id' => $workspace->id()]);
    $other_team->save();
    self::assertInstanceOf(BbTeamInterface::class, $other_team);
    $this->otherTeam = $other_team;

    $stranger = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $stranger);
    $this->strangerInAnotherTeam = $stranger;
    Og::createMembership($other_team, $stranger)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
  }

  /**
   * An account that may change the crew removes a member, and the row is gone.
   */
  public function testAnAccountThatMayUpdateTheGroupRemovesTheMember(): void {
    $this->actAs(['view bb_team', 'update any bb_team']);
    self::assertSame(1, $this->membershipCount(), 'the fixture starts with the member in');

    $errors = $this->submitRemoveForm();

    self::assertSame([], $errors, 'the submit reached the delete without a validation error');
    self::assertSame(0, $this->membershipCount(), 'the membership row is gone');
  }

  /**
   * THE SECURITY PROPERTY: the submit itself is refused, not just the button.
   */
  public function testTheSubmitIsRefusedForAnAccountThatMayOnlyViewTheGroup(): void {
    $this->actAs(['view bb_team']);

    $this->expectException(AccessDeniedHttpException::class);
    try {
      $this->submitRemoveForm();
    }
    finally {
      self::assertSame(
        1,
        $this->membershipCount(),
        'the refusal happens BEFORE the delete, not after it',
      );
    }
  }

  /**
   * THE ROW THAT WAS PRESSED IS THE ROW THAT GOES.
   *
   * The two uids are deliberately different, because that difference IS the
   * defect. The form instance is built for the FIRST row — which is the one
   * that wins the POST, since every row shares a form id — while the request
   * names the SECOND, which is the row the human actually pressed. A control
   * that reads "which member" from what it was BUILT with rather than from what
   * was SENT removes the first, and the list still loses exactly one row.
   */
  public function testTheMemberThePostNamesIsRemovedAndNotTheRowTheFormWasBuiltFor(): void {
    $this->actAs(['view bb_team', 'update any bb_team']);
    $first = (int) $this->crewMember->id();
    $second = (int) $this->otherCrewMember->id();
    // Measured rather than hardcoded: og_entity_insert() gives a group's OWNER
    // a membership of its own (og.module:56-69), so the crew is larger than the
    // two accounts this fixture adds. Reading the baseline keeps the assertion
    // about which member went rather than about how many there were.
    $before = $this->crewUids();
    self::assertContains($first, $before);
    self::assertContains($second, $before);

    $errors = $this->submitRemoveForm(built_for: $first, pressed: $second);

    self::assertSame([], $errors, 'the submit reached the delete without a validation error');
    $after = $this->crewUids();
    self::assertNotContains($second, $after, 'the member the POST named is gone');
    self::assertContains($first, $after, 'the row the form was BUILT for is still a member');
    self::assertSame(
      array_values(array_diff($before, [$second])),
      $after,
      'exactly one membership went, and it was the pressed one',
    );
  }

  /**
   * A remove succeeds even where the add control holds unresolved text.
   *
   * `EntityAutocomplete::getInfo()` attaches `#element_validate`
   * unconditionally, so the person control's own matcher used to run on
   * EVERY submit regardless of `#required` — refusing this exact case with
   * an autocomplete error on a field the remove never touches. An operator
   * who typed into *Add a member*, changed their mind, and pressed Remove
   * on any item hit it every time.
   */
  public function testRemoveSucceedsWhileTheAddControlHoldsUnresolvedText(): void {
    $this->actAs(['view bb_team', 'update any bb_team']);
    self::assertSame(1, $this->membershipCount(), 'the fixture starts with the member in');

    $errors = $this->submitRemoveForm(account_text: 'no such person');

    self::assertSame(
      [],
      $errors,
      'the abandoned add text must not refuse a remove that never reads it',
    );
    self::assertSame(0, $this->membershipCount(), 'the membership row is still gone');
  }

  /**
   * A uid the POST names but this group does not hold removes nothing.
   *
   * THE RE-VALIDATION, and the reason a submitted value is safe here. The group
   * comes from the HOST — the route — and never from the request, so the query
   * the submit runs is already scoped to it. A forged uid can therefore only
   * ever select among memberships of the group the actor already holds `update`
   * on; it cannot reach a membership of another team, and it cannot reach an
   * account that is simply not in this one.
   */
  public function testUidThisGroupDoesNotHoldRemovesNothingAnywhere(): void {
    $this->actAs(['view bb_team', 'update any bb_team']);
    $stranger = (int) $this->strangerInAnotherTeam->id();
    $before = $this->crewUids();
    $other_before = $this->crewUids($this->otherTeam);
    self::assertNotContains($stranger, $before, 'the stranger is not in this crew');
    self::assertContains($stranger, $other_before, 'but does hold a membership elsewhere');

    $errors = $this->submitRemoveForm(
      built_for: (int) $this->crewMember->id(),
      pressed: $stranger,
    );

    self::assertSame([], $errors);
    self::assertSame($before, $this->crewUids(), 'this team kept every member it had');
    self::assertSame(
      $other_before,
      $this->crewUids($this->otherTeam),
      "the other team's membership was not reachable from this form",
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
    $this->enterTeamRoute();
    return $account;
  }

  /**
   * Submits the remove form, as the island's POST does.
   *
   * `$built_for` IS VESTIGIAL AND KEPT DELIBERATELY. It named the row a per-row
   * form INSTANCE was rendered for, which is what the Views field used to pass
   * as a build arg. There are no instances any more, so it selects nothing and
   * only `$pressed` decides — but the parameter stays so the two identity cases
   * below read exactly as they did. The property they assert is
   * mechanism-independent, and a helper collapsing the two could not express
   * the defect it exists to catch.
   *
   * `setValues()` rather than `setUserInput()`: FormBuilder::submitForm()
   * overwrites the input WITH the values, so the values are how a programmatic
   * submit reaches a form that reads its trigger out of the input.
   *
   * @param int $built_for
   *   The uid this form instance is rendered for.
   * @param int|null $pressed
   *   The uid the request names, or NULL to send no member at all — which is
   *   what the single-row cases below want, since they assert the gate rather
   *   than the selection.
   * @param string|null $account_text
   *   Text left in the add control's `account` field, simulating an
   *   abandoned add sitting beside the pressed remove trigger.
   *
   * @return array<string, string>
   *   The validation errors, so a silent validation failure cannot pass for a
   *   refused write.
   */
  private function submitRemoveForm(?int $built_for = NULL, ?int $pressed = NULL, ?string $account_text = NULL): array {
    $form_state = new FormState();
    $pressed ??= $built_for ?? (int) $this->crewMember->id();
    $values = [
      // THE MEMBER IS THE REQUEST KEY, not a value beside it. One form owns the
      // whole face, so each item's control is `remove_member_<uid>` and the key
      // IS the selection. `FormBuilder::submitForm()` calls
      // `setUserInput($form_state->getValues())` before retrieving the form, so
      // a value set here arrives as the input the form reads.
      'remove_member_' . $pressed => (string) $pressed,
    ];
    if ($account_text !== NULL) {
      $values['account'] = $account_text;
    }
    $form_state->setValues($values);
    $this->container->get('form_builder')->submitForm(
      GroupMembersForm::class,
      $form_state,
      ['island_id' => 'members', 'host_id' => 'team'],
    );
    return array_map(
      static fn ($message): string => (string) $message,
      $form_state->getErrors(),
    );
  }

  /**
   * How many memberships of this team the crew member holds.
   */
  private function membershipCount(): int {
    $ids = $this->container->get('entity_type.manager')
      ->getStorage('og_membership')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', 'bb_team')
      ->condition('entity_id', (string) $this->team->id())
      ->condition('uid', (string) $this->crewMember->id())
      ->execute();
    return count($ids);
  }

  /**
   * The uids a team's crew holds, ascending — the identity, not the size.
   *
   * A COUNT IS NOT AN ACCEPTABLE SUBSTITUTE and this helper exists to make that
   * impossible to write by accident. Removing the wrong member changes the
   * count by exactly one, the same as removing the right one, which is how the
   * defect reached review through both a kernel test and a browser scenario.
   *
   * @param \Drupal\bb_core\Entity\BbTeamInterface|null $team
   *   The team to read, defaulting to the one every case here acts on.
   *
   * @return array<int>
   *   The member uids, sorted so the assertion does not depend on row order —
   *   which the view leaves unspecified anyway.
   */
  private function crewUids(?BbTeamInterface $team = NULL): array {
    $team ??= $this->team;
    $storage = $this->container->get('entity_type.manager')->getStorage('og_membership');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', 'bb_team')
      ->condition('entity_id', (string) $team->id())
      ->execute();
    $uids = [];
    foreach ($storage->loadMultiple($ids) as $membership) {
      // Narrowed rather than assumed: og_membership storage is typed to
      // EntityInterface, which has no owner.
      if ($membership instanceof OgMembershipInterface) {
        $uids[] = (int) $membership->getOwnerId();
      }
    }
    sort($uids);

    return $uids;
  }

  /**
   * Makes the team's Members route the current one.
   *
   * The host reads the team off the route match, and `CurrentRouteMatch`
   * answers with a `NullRouteMatch` for anything less than a real request
   * carrying a real route object.
   */
  private function enterTeamRoute(): void {
    $route_name = 'bb_core.bb_team.members';
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $request = Request::create('/group-member-remove-test');
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('bb_workspace', $this->workspace);
    $request->attributes->set('bb_team', $this->team);
    $this->container->get('request_stack')->push($request);
  }

}
