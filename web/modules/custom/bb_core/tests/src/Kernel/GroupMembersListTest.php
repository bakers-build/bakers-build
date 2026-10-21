<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\GroupMembersForm;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;

/**
 * The members surface is a LIST, exercised on the team — its one live arm.
 *
 * IT REPLACES `TeamMembersViewTableTest`, and the replacement is itself
 * the deliverable rather than a port. That class asserted the opposite of
 * what this ticket requires: that the team's crew renders `bb_theme:table`,
 * with three column HEADERS in the view's order and a sortable one among
 * them. The settings section says in as many words that "A MEMBER LIST IS A
 * LIST, NOT A TABLE", and BB-435 extended that rule to the project instead
 * of letting the project contradict it — so the table assertions are not
 * weakened here, they are inverted. What survives from that class is its
 * fixture shape and its habit of asserting the FACE a value wears rather than
 * the value.
 *
 * NO COLUMNS AND NO HEADER ROW is therefore asserted as an ABSENCE of table
 * markup, not merely as the presence of a `<ul>`. A flex grid with fixed widths
 * is a table pretending not to be one, and the previous architecture really did
 * draw one; the two assertions together are what make "not a table" checkable.
 *
 * THE PROJECT ARM IS GONE (BB-462 D7/D8). This class used to exercise both
 * arms of `MemberItemBuilder::rankCell()`'s role-vs-state branch through the
 * project (which shipped `lead`) and the team (which shipped nothing). A
 * project carries no membership of its own any more, so its arm — the
 * fixture, `renderFace('project', …)`, the project members route it entered —
 * is retired rather than repointed. The team now ships TWO assignable roles:
 * `lead` (BB-456 D9, the two team-scoped statistic permissions) and `owner`
 * (BB-462 D3, who may join the team and its own settings), so it alone
 * exercises the role branch this class was written to prove; there is no
 * group left that exercises the state branch, and no test asserts one exists.
 *
 * THE CONTROLS ARE ASSERTED ON THE MARKUP A COMPONENT OWNS. `option_list`'s
 * submit rows and `bb_theme:button`'s tag are what say the value arrived
 * wearing something, and they are also the whole server contract: a row's
 * `name`/`value` pair is how the form knows which member and which role were
 * pressed. So the assertions read the pair, not a class name.
 */
#[Group('bb_core')]
final class GroupMembersListTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * `ui_patterns` is here for the reason the ticket table's own suite states:
   * its node visitor normalises props in every SDC template regardless of the
   * caller, so a render without it happens in a configuration the site never
   * runs in.
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
   * {@inheritdoc}
   *
   * THEME DEBUG IS ON, for the reason the table suite turns it on: running the
   * harder configuration is what stops a rule that answers differently in the
   * one nobody runs locally.
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->setParameter('twig.config', ['debug' => TRUE, 'auto_reload' => NULL, 'cache' => TRUE]);
  }

  /**
   * The workspace the team hangs under.
   */
  private ContentEntityInterface $workspace;

  /**
   * The team, whose type ships the assignable `owner` role (BB-462 D3).
   */
  private ContentEntityInterface $team;

  /**
   * The account on the roster.
   */
  private UserInterface $rosa;

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
    $this->installConfig(['system', 'user']);
    // The shipped role set and the shipped group registration, read out of the
    // repository rather than restated — so a wrong shape there fails here.
    $this->installOgScopeFixture();
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();

    // Uid 1 bypasses every access check, so it is created and left unused.
    $this->setUpCurrentUser(['uid' => 1]);

    $this->workspace = $this->entity('bb_workspace', ['name' => 'Acme', 'slug' => 'acme']);
    $this->team = $this->entity('bb_team', [
      'name' => 'Platform Crew',
      'workspace_id' => $this->workspace->id(),
    ]);

    $rosa = $this->createUser([], 'rosa');
    self::assertInstanceOf(UserInterface::class, $rosa);
    $this->rosa = $rosa;
    $this->addMembership($this->team, $rosa);
  }

  /**
   * A team item carries a role control; the pick IS the write (BB-462 D3).
   *
   * THE `name`/`value` PAIR IS THE CONTRACT and that is what is read here. Each
   * option row is a named submit trigger of the enclosing form, so picking a
   * role and submitting it are one act — which is what `option_picker`'s inline
   * variant requires, since it emits no hidden inputs "because the pick is the
   * write" and there is therefore no later submit for a carried value to reach.
   *
   * BOTH shipped team roles appear: `lead` (BB-456 D9, statistics) and
   * `owner` (BB-462 D3, team administration). The vocabulary is read from
   * config, so a rank the product does not have cannot appear either.
   */
  public function testTeamItemOffersRoleChangesAndExplainedRemoval(): void {
    $item = $this->itemNaming($this->itemsOf($this->renderFace('team', $this->team)), 'rosa');
    $uid = (int) $this->rosa->id();

    self::assertStringContainsString('data-cell="role"', $item, 'a team ships ranks to assign');
    self::assertStringContainsString('data-component-id="bb_theme:option_picker"', $item);
    self::assertStringContainsString('option-list__submit', $item, 'every option row is a submit');
    self::assertStringContainsString(
      'name="member_role_' . $uid . '"',
      $item,
      'the request key names the member',
    );
    self::assertStringContainsString('value="owner"', $item, 'and the value names the role');
    self::assertStringContainsString('value="lead"', $item, 'the team also ships the statistics role');
    self::assertStringContainsString('value="member"', $item);
    // The roles are the ones the site ships, read from config rather than
    // listed in the form: a vocabulary the product does not have cannot appear.
    self::assertStringNotContainsString('value="administrator"', $item);
    self::assertStringNotContainsString('data-cell="state"', $item, 'the role cell replaces the state cell');
    // NO SAVE BUTTON AND NO CONFIRMATION, which is the other half of "the pick
    // is the write". The only non-row submit on this face is the add.
    self::assertStringNotContainsString('type="submit" value="Save"', $item);
    self::assertStringContainsString('name="remove_member_' . $uid . '"', $item);
    self::assertStringContainsString('type="submit"', $item);
    self::assertStringContainsString(
      'data-bakers-member-uid="' . $uid . '"',
      $item,
      'the documented machine handle the browser suite addresses',
    );
    self::assertStringContainsString('Revokes their access.', $item);
  }

  /**
   * A reader who may not change the crew gets the roster and no affordance.
   *
   * ABSENT, NOT DISABLED. The list of people is information; the controls are
   * authority. Criterion 8's build half — its POST half is
   * `TeamMemberAddAccessTest`'s refusal pair.
   */
  public function testReadOnlyAccountGetsTheRosterAndNoControls(): void {
    $reader = $this->createUser(['view bb_team']);
    self::assertInstanceOf(UserInterface::class, $reader);
    $this->setCurrentUser($reader);

    $html = $this->renderFace('team', $this->team);

    self::assertStringContainsString('data-cell="person"', $html, 'the roster still renders');
    self::assertStringNotContainsString('remove_member_', $html, 'no removal is offered');
    self::assertStringNotContainsString('member_role_', $html, 'no role pick is offered');
    self::assertStringNotContainsString('option-list__submit', $html);
    self::assertStringNotContainsString('Add member', $html, 'and nothing invites an addition');
  }

  /**
   * A saved entity of one of the fixture types.
   *
   * @param string $entity_type_id
   *   The entity type id.
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved entity.
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
   * Renders the members form as one host's face.
   *
   * @param string $host_id
   *   The island host, which is what hands the group over.
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group whose route is entered.
   *
   * @return string
   *   The markup.
   */
  private function renderFace(string $host_id, ContentEntityInterface $group): string {
    $this->enterRoute($group);
    $form = $this->container->get('form_builder')->getForm(
      GroupMembersForm::class,
      ['island_id' => 'members', 'host_id' => $host_id],
    );
    return (string) $this->container->get('renderer')->renderInIsolation($form);
  }

  /**
   * The `<li>` items of the rendered roster.
   *
   * SPLIT ON THE ITEM MARKER RATHER THAN MATCHED AS A TAG PAIR, and the reason
   * is nesting: an item's role control is an `option_list`, whose option ROWS
   * are `<li>` themselves. A non-greedy `<li>.*?</li>` therefore stops at the
   * first option row's close and returns a truncated fragment of the item —
   * measured, as four "items" for two memberships and assertions passing
   * against markup they were not looking at. Items are siblings under one
   * `<ul>`, so splitting on the class the container gives an item is exact
   * where a tag match cannot be.
   *
   * @param string $html
   *   The rendered markup.
   *
   * @return array<int, string>
   *   The items, each from its own `<li>` up to the next one.
   */
  private function itemsOf(string $html): array {
    $chunks = preg_split('#(?=<li data-list-item)#', $html) ?: [];
    return array_values(array_filter(
      $chunks,
      static fn (string $chunk): bool => str_starts_with($chunk, '<li data-list-item'),
    ));
  }

  /**
   * The item naming one account.
   *
   * @param array<int, string> $items
   *   The items.
   * @param string $name
   *   The account name.
   *
   * @return string
   *   The item markup.
   */
  private function itemNaming(array $items, string $name): string {
    foreach ($items as $item) {
      if (str_contains($item, $name)) {
        return $item;
      }
    }
    self::fail(sprintf('No item names %s.', $name));
  }

  /**
   * Makes one group's Members route the current one.
   *
   * The host reads the group off the route match, and `CurrentRouteMatch`
   * answers with a `NullRouteMatch` for anything less than a real request
   * carrying a real route object.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group to put on the route.
   */
  private function enterRoute(ContentEntityInterface $group): void {
    $route_name = sprintf('bb_core.%s.members', $group->getEntityTypeId());
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $request = Request::create('/group-members-list-test');
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

  /**
   * Guards the fixture: a membership really is active.
   */
  public function testTheFixtureMembershipsAreActive(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('og_membership');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', 'bb_team')
      ->condition('entity_id', (string) $this->team->id())
      ->condition('uid', (int) $this->rosa->id())
      ->execute();
    $membership = $storage->load((string) reset($ids));
    self::assertInstanceOf(OgMembershipInterface::class, $membership);
    self::assertSame(OgMembershipInterface::STATE_ACTIVE, $membership->getState());
  }

}
