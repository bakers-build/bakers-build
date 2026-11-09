<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * The D6 workspace matrix, asserted as HTTP status codes (V5, BB-350 D6).
 *
 * Deliberately BrowserTestBase-free and deliberately a KERNEL test, for two
 * measured reasons rather than taste. The confirmed test plan asks for HTTP
 * assertions without a browser; and `.gitlab-ci.yml` runs only
 * bb_core/tests/src/{Unit,Kernel} plus two other Kernel directories, so the
 * same file under tests/src/Functional would never run in CI and would gate
 * nothing. Requests go through the real http_kernel, so the router, the param
 * converters, the access checks and the exception subscriber all participate —
 * everything a browser test would exercise except the browser.
 *
 * The distinction the matrix exists to pin is 404 versus 403. A workspace
 * mismatch answers 404 and never 403, because a 403 confirms the row exists in
 * some other workspace, which is precisely the fact tenancy withholds. A
 * right-workspace/wrong-permission request still answers 403 — that one is not
 * a secret, and it is the existing _entity_access verdict, untouched.
 *
 * @SuppressWarnings("PHPMD.TooManyPublicMethods")
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceRouteAccessTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    // `island` is here because the routes this class REQUESTS need it — the
    // team's five tab routes resolve an island host, exactly as the retired
    // BB-419 project canonical route once did.
    'island',
    // BB-462 D8/F11: the project canonical route now REDIRECTS to the
    // Tickets view rather than rendering its own face, so
    // `view.tickets.project_tickets` needs to be a REGISTERED route or the
    // redirect target cannot be resolved. `views` alone, plus a MINIMAL stub
    // view built in setUp() rather than the real shipped one: the shipped
    // `views.view.tickets` pulls in facets/search_api/better_exposed_filters
    // schema this class has no other reason to carry, and this class is
    // about ROUTING, not about the view's own content or filters.
    'views',
    'link', 'text', 'bb_core',
  ];

  /**
   * The workspace the fixtures live in.
   */
  private ContentEntityInterface $home;

  /**
   * A second workspace, used for the cross-workspace assertions.
   */
  private ContentEntityInterface $other;

  /**
   * The ticket at /bakers/ticket/bb-1.
   */
  private ContentEntityInterface $ticket;

  /**
   * The project at /bakers/project/bb.
   */
  private ContentEntityInterface $project;

  /**
   * A run, i.e. a type addressed by its numeric id.
   */
  private ContentEntityInterface $run;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_environment', 'bb_run',
      // The add forms below render entity-reference widgets for the
      // conductor and the label vocabulary, which query these tables.
      'bb_comment', 'bb_conductor', 'bb_term', 'bb_invite', 'bb_machine',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->installOgScopeFixture();
    $this->installMinimalTicketsProjectView();
    // User 1 bypasses every access check; consume that uid so the accounts
    // below are ordinary users whose verdicts this test can actually measure.
    $this->createAccount('root', []);

    $this->home = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);
    $this->other = $this->create('bb_workspace', ['name' => 'Other', 'slug' => 'other']);
    $group = $this->create('bb_group', [
      'name' => 'bakers.build group',
      'workspace_id' => $this->home->id(),
    ]);
    $this->project = $this->create('bb_project', [
      'name' => 'bakers.build',
      'key' => 'BB',
      'group_id' => $group->id(),
    ]);
    $this->ticket = $this->create('bb_ticket', [
      'title' => 'A workspace-scoped ticket',
      'project_id' => $this->project->id(),
    ]);
    $this->run = $this->create('bb_run', ['ticket_id' => $this->ticket->id()]);

    $this->container->get('router.builder')->rebuild();
  }

  /**
   * A member reaching its own workspace's ticket gets the page.
   */
  public function testRightWorkspaceIsServed(): void {
    $this->actAs($this->memberWithViewAccess());

    self::assertSame(200, $this->statusOf('/bakers/ticket/bb-1'));
    // The project canonical route now serves Overview directly (BB-454
    // round 4): the redirect-to-Tickets shape BB-462 D8/F11 put here was
    // superseded once Overview got a face of its own, and canonical is
    // gated on `bb_project.view` rather than `.update`, so a member with
    // ordinary view access gets 200 rather than a redirect or a 403.
    self::assertSame(200, $this->statusOf('/bakers/project/bb'));
    self::assertSame(200, $this->statusOf($this->runCanonicalPath()));
    self::assertSame(200, $this->statusOf($this->runCanonicalPath() . '/overlay'));
    self::assertSame(404, $this->statusOf('/bakers/run/' . $this->run->id()));
  }

  /**
   * The workspace member list has a real address (BB-462 D8, F3).
   *
   * The review that sent this ticket back to `coding` found no route,
   * controller or island for it at all — only the team screen's surface
   * existed, and D8 explicitly moves the member-management HOST up from the
   * retired project one to the workspace. This is the seam that host now
   * lives on: `/{slug}/settings/members`, gated on workspace update (the
   * same gate as Settings), because adding a person is an invitation.
   */
  public function testWorkspaceMembersRouteIsServed(): void {
    $lead = $this->createAccount('members-lead', []);
    $this->addMembership($this->home, $lead, ['lead']);
    $this->actAs($lead);

    self::assertSame(200, $this->statusOf('/bakers/settings/members'));
  }

  /**
   * The same row under another workspace's slug is 404, never 403.
   *
   * The account is a member of BOTH workspaces and holds view access, so
   * nothing but the workspace mismatch can be producing the 404 — which is what
   * makes this assertion evidence rather than a coincidence.
   */
  public function testWrongWorkspaceIs404(): void {
    $account = $this->memberWithViewAccess();
    $this->addMembership($this->other, $account);
    $this->actAs($account);

    self::assertSame(404, $this->statusOf('/other/ticket/bb-1'));
    self::assertSame(404, $this->statusOf('/other/project/bb'));
    self::assertSame(404, $this->statusOf('/other/ticket/bb-1/run/' . $this->run->id()));
  }

  /**
   * A slug no workspace carries is 404 — the converter answers NULL.
   */
  public function testUnknownSlugIs404(): void {
    $this->actAs($this->memberWithViewAccess());

    self::assertSame(404, $this->statusOf('/nope/ticket/bb-1'));
    self::assertSame(404, $this->statusOf('/nope/project/bb'));
  }

  /**
   * An identifier or key that matches no row is 404.
   */
  public function testUnknownHumanReferenceIs404(): void {
    $this->actAs($this->memberWithViewAccess());

    self::assertSame(404, $this->statusOf('/bakers/ticket/bb-99999'));
    self::assertSame(404, $this->statusOf('/bakers/project/nosuch'));
    self::assertSame(404, $this->statusOf('/bakers/run/99999'));
    self::assertSame(404, $this->statusOf('/bakers/ticket/bb-1/run/99999'));
  }

  /**
   * A nested run URL that names the wrong ticket is 404, never 403.
   */
  public function testRunParentageMismatchIs404(): void {
    $other = $this->create('bb_ticket', [
      'title' => 'A second ticket',
      'project_id' => $this->project->id(),
    ]);
    $this->actAs($this->memberWithViewAccess());

    self::assertSame(404, $this->statusOf($this->runCanonicalPath($other)));
    self::assertSame(200, $this->statusOf($this->runCanonicalPath()));
  }

  /**
   * A workspace outside the account's read scope is 404.
   *
   * The account holds `view bb_ticket`, so _entity_access would allow the
   * page. Only the missing membership can be answering, and it answers 404
   * rather than 403 so the URL does not confirm the workspace exists.
   */
  public function testWorkspaceOutsideReadScopeIs404(): void {
    $stranger = $this->createAccount('stranger', ['view bb_ticket']);
    $this->actAs($stranger);

    self::assertSame(404, $this->statusOf('/bakers/ticket/bb-1'));
  }

  /**
   * An orphan row 404s under the workspace it renders as.
   *
   * BbWorkspaceRouteProcessor gives such a row the default workspace's slug
   * so a listing containing it can render at all (see
   * WorkspaceUrlGenerationTest::testEntityWithoutWorkspaceFallsBackToTheDefaultWorkspace).
   * That is a rendering fallback, and this is the assertion that it stays one:
   * the account below is a full member of the workspace the link names, so
   * only the row's own unresolvable chain can be answering.
   */
  public function testRowWithNoWorkspaceIs404UnderTheDefaultWorkspace(): void {
    $orphan = $this->create('bb_ticket', ['title' => 'No project']);
    $reference = mb_strtolower((string) $orphan->get('identifier')->value);
    $this->actAs($this->memberWithViewAccess());

    self::assertSame(404, $this->statusOf('/bakers/ticket/' . $reference));
  }

  /**
   * The right workspace without sufficient rank stays 403.
   *
   * The workspace check has nothing to object to here — the account is a member
   * of the workspace and the path names the ticket's own workspace — so the
   * existing _entity_access verdict is what the request meets. Losing this
   * distinction would mean tenancy had swallowed the permission system.
   *
   * BB-359 changed WHICH operation can show it, not whether it holds.
   * BB-462 D1 changed it again: a BARE membership (no explicit role) is
   * powerless once
   * more, because the implicit `member` rank is now emptied deliberately — OG
   * ranks are additive and cannot be narrowed, so any right left on it would be
   * inherited by every membership including guests. The account below therefore
   * holds the explicit `contributor` role instead, which carries `view
   * bb_ticket` for the same reason `member` used to. The row is measured on
   * `delete`, which the ladder really does differentiate: `delete any
   * bb_ticket` sits on `lead`/admin and on no rank below it.
   *
   * Note this row is only reachable while SOME operation separates two ranks.
   * It would become unreachable if the vocabulary lost that separation — see
   * the `guest`/`app` finding reported on BB-359.
   */
  public function testRightWorkspaceWithoutPermissionIs403(): void {
    $member = $this->createAccount('powerless', []);
    $this->addMembership($this->home, $member, ['contributor']);
    $this->actAs($member);

    // The rank it does hold reaches the ticket.
    self::assertSame(200, $this->statusOf('/bakers/ticket/bb-1'));
    // The one it does not stops at the entity access verdict, not at tenancy.
    self::assertSame(403, $this->statusOf('/bakers/ticket/bb-1/delete'));
  }

  /**
   * Every moved singular admin path is gone, with no redirect.
   *
   * D6 chose fail-closed: the routes MOVED, so the old paths stop existing on
   * their own. An account that can see everything is used on purpose — a 404
   * measured with a powerless account would prove nothing.
   */
  public function testLegacyAdminPathsAre404(): void {
    $this->actAs($this->createAccount('admin', ['administer bakers']));

    foreach ([
      '/admin/bakers/ticket/' . $this->ticket->id(),
      '/admin/bakers/ticket/' . $this->ticket->id() . '/edit',
      '/admin/bakers/ticket/add',
      '/admin/bakers/project/' . $this->project->id(),
      '/admin/bakers/run/' . $this->run->id(),
      '/admin/bakers/group/1',
      '/admin/bakers/team/1',
      '/admin/bakers/comment/1',
      '/admin/bakers/environment/1',
    ] as $path) {
      self::assertSame(404, $this->statusOf($path), sprintf('%s must be gone.', $path));
    }
  }

  /**
   * Content entities and the site settings have no admin pages.
   */
  public function testContentEntityAdminPathsAre404(): void {
    $this->actAs($this->createAccount('admin2', ['administer bakers']));
    $conductor = $this->conductor($this->createAccount('runner', []));

    foreach ([
      '/admin/bakers/workspaces',
      '/admin/bakers/workspace/add',
      '/admin/bakers/workspace/' . $this->home->id(),
      '/admin/bakers/workspace/' . $this->home->id() . '/edit',
      '/admin/bakers/workspace/' . $this->home->id() . '/delete',
      '/admin/bakers/conductors',
      '/admin/bakers/conductor/add',
      '/admin/bakers/conductor/' . $conductor->id() . '/edit',
      '/admin/bakers/conductor/' . $conductor->id() . '/delete',
      '/admin/bakers/machines',
      '/admin/bakers/machine/add',
      '/admin/bakers/tickets',
      '/admin/bakers/projects',
      '/admin/bakers/teams',
      '/admin/bakers/groups',
      '/admin/bakers/comments',
      '/admin/bakers/runs',
      '/admin/bakers/ticket-templates',
      '/admin/bakers',
      '/admin/bakers/settings',
      '/admin/bakers/config',
    ] as $path) {
      self::assertSame(404, $this->statusOf($path), sprintf('%s must be gone.', $path));
    }
  }

  /**
   * Workspace, conductor and machine delete on product paths, as before.
   */
  public function testProductDeleteRoutesKeepDeleteAccess(): void {
    $owner = $this->createAccount('owner', [
      'delete any bb_workspace', 'delete any bb_conductor', 'delete any bb_machine',
    ]);
    $this->addMembership($this->home, $owner);
    $guest = $this->createAccount('guest', []);
    $this->addMembership($this->home, $guest);
    $conductor = $this->conductor($owner);
    $machine = $this->create('bb_machine', ['name' => 'host', 'host_key' => 'host-1', 'owner_user_id' => $owner->id()]);

    $this->actAs($owner);
    self::assertSame(200, $this->statusOf('/bakers/delete'));
    self::assertSame(200, $this->statusOf('/bakers/conductor/' . $conductor->id() . '/delete'));
    self::assertSame(200, $this->statusOf('/user/' . $owner->id() . '/machine/' . $machine->id() . '/delete'));

    $this->actAs($guest);
    self::assertSame(403, $this->statusOf('/bakers/delete'));
    self::assertSame(403, $this->statusOf('/bakers/conductor/' . $conductor->id() . '/delete'));
  }

  /**
   * A conductor of the fixture project.
   */
  private function conductor(UserInterface $owner): ContentEntityInterface {
    return $this->create('bb_conductor', [
      'conductor_id' => 'c-' . $owner->id(),
      'label' => 'Conductor',
      'project_id' => $this->project->id(),
      'owner_user_id' => $owner->id(),
    ]);
  }

  /**
   * The static add-form paths win over the sibling reference slot.
   *
   * `/bakers/ticket/add` and `/bakers/project/add` sit beside routes whose last
   * segment is now a human reference rather than a digits-only id, so `add`
   * became a syntactically plausible reference. It must still reach the add
   * form.
   */
  public function testAddFormPathsStillMatchTheirOwnRoute(): void {
    $this->actAs($this->createAccount('adder', ['administer bakers']));

    self::assertSame(200, $this->statusOf('/bakers/ticket/add'));
    self::assertSame(200, $this->statusOf('/bakers/project/add'));
  }

  /**
   * A ticket may still be addressed by its UUID at the new address.
   *
   * The capability the deleted BbTicketUuidRouteSubscriber provided, folded
   * into BbTicketIdentifierConverter. JSON:API hands out UUIDs and the bakers
   * CLI pastes them, so losing this would break a second thing at the same
   * moment the paths move.
   */
  public function testTicketIsStillAddressableByUuid(): void {
    $this->actAs($this->memberWithViewAccess());

    self::assertSame(200, $this->statusOf('/bakers/ticket/' . $this->ticket->uuid()));
    self::assertSame(200, $this->statusOf('/bakers/ticket/' . $this->ticket->id()));
  }

  /**
   * The ticket-relative canonical path of the fixture run.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface|null $ticket
   *   The ticket named in the path. Defaults to the fixture ticket.
   */
  private function runCanonicalPath(?ContentEntityInterface $ticket = NULL): string {
    $ticket ??= $this->ticket;
    $identifier = mb_strtolower((string) $ticket->get('identifier')->value);
    return '/bakers/ticket/' . $identifier . '/run/' . $this->run->id();
  }

  /**
   * Runs a request through the real HTTP kernel and returns its status.
   *
   * @param string $path
   *   The path to request.
   *
   * @return int
   *   The HTTP status code.
   */
  private function statusOf(string $path): int {
    $request = Request::create($path);
    $response = $this->container->get('http_kernel')->handle($request);
    // Each request runs against a fresh request stack entry; drop the one the
    // kernel pushed so the next call starts clean.
    $this->container->get('request_stack')->pop();
    return $response->getStatusCode();
  }

  /**
   * Makes an account the current user for the requests that follow.
   *
   * @param \Drupal\user\UserInterface $account
   *   The account to act as.
   */
  private function actAs(UserInterface $account): void {
    $this->container->get('current_user')->setAccount($account);
  }

  /**
   * A workspace member holding read access to the fixtures.
   *
   * @return \Drupal\user\UserInterface
   *   The saved account.
   */
  private function memberWithViewAccess(): UserInterface {
    $account = $this->createAccount('member', [
      'view bb_ticket', 'view bb_project', 'view bb_run',
    ]);
    $this->addMembership($this->home, $account);
    return $account;
  }

  /**
   * Creates a user holding exactly the given permissions.
   *
   * @param string $name
   *   The user name, also used to derive a dedicated role id.
   * @param array<string> $permissions
   *   The permissions to grant on that role.
   *
   * @return \Drupal\user\UserInterface
   *   The saved user.
   */
  private function createAccount(string $name, array $permissions): UserInterface {
    $role_id = 'r_' . $name;
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    if ($permissions !== []) {
      user_role_grant_permissions($role_id, $permissions);
    }
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves an entity of the given type.
   *
   * @param string $entity_type_id
   *   The entity type to create.
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved entity.
   */
  private function create(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Registers the ONE route this class needs from the Tickets view.
   *
   * A stub with the same id, display id and path as the shipped
   * `views.view.tickets`'s `project_tickets` display — enough for Views'
   * route subscriber to register `view.tickets.project_tickets`, which is
   * all `BbProjectCanonicalRedirectController` needs to resolve its
   * redirect target. Deliberately NOT the shipped view: this class tests
   * ROUTING, and the shipped view's facets/exposed-filter schema would pull
   * in modules (`facets`, `search_api`, `better_exposed_filters`) this class
   * has no other reason to carry and no assertion that needs.
   */
  private function installMinimalTicketsProjectView(): void {
    $this->container->get('entity_type.manager')->getStorage('view')->create([
      'id' => 'tickets',
      'base_table' => 'users_field_data',
      'display' => [
        'default' => [
          'display_plugin' => 'default',
          'id' => 'default',
          'display_title' => 'Default',
          'position' => 0,
          'display_options' => [],
        ],
        'project_tickets' => [
          'display_plugin' => 'page',
          'id' => 'project_tickets',
          'display_title' => 'Project tickets',
          'position' => 1,
          'display_options' => [
            'path' => '_workspace/%bb_workspace/project/%bb_project/tickets',
          ],
        ],
      ],
    ])->save();
  }

}
