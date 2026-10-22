<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\BbTicketCreateForm;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * The create dialog is a ROUTE, and the shell holds an empty container.
 *
 * BB-420 Task 24 replaced the island that hosted this dialog — a host, a
 * plugin, a bb_core-owned ui_patterns source and a POST event subscriber —
 * with a route whose form IS main content. This file is what took the place of
 * `TicketCreateOverlayTest`, which asserted the island half of exactly the same
 * two claims: WHO MAY OPEN THE DIALOG, and WHAT PAINTS THE PLACE IT LANDS IN.
 *
 * THE SECOND CLAIM MOVED AGAIN, TASK 26. The `ui_patterns` Source this class
 * used to assert (`BbOverlaySource`) is itself gone — `shell.twig` now paints
 * `#bakers-overlay` directly, unconditionally, rather than through a
 * page-layout source — so "what paints the place it lands in" is covered by
 * `ShellOverlayTargetTest` instead. What stays here is only the first claim.
 *
 * WHAT GATES IT NOW. The island had two doors — its host's own
 * `accessIsland()` and the form's `create bb_ticket` check — and Ruling R10
 * is that neither trusts the other. The first is replaced by the ROUTE's own
 * `_entity_create_access: bb_ticket`, which is stronger in placement rather
 * than weaker: it runs in the router, before a controller is reached, whereas
 * the island's check ran at render time inside a page-layout source. The second
 * is untouched and stays, which is why this file asserts the route requirement
 * and `TicketCreateFormTest` still asserts the form's.
 *
 * `_entity_create_access` resolves through `BbTicketAccessControlHandler`, so
 * the third case asks that handler directly — the same lookup the router
 * performs — for an account that holds the permission and one that does not.
 */
#[Group('bb_core')]
final class TicketCreateRouteTest extends KernelTestBase {

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
    'ui_patterns', 'island', 'bb_core',
  ];

  /**
   * The route the trigger points at.
   */
  private const ROUTE = 'entity.bb_ticket.create_form';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_group', 'bb_workspace', 'bb_ticket'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'bb_core']);
  }

  /**
   * The curated form has a route of its own, under the workspace prefix.
   *
   * NOT the entity's `add-form`. That route renders `BbTicketForm` — every
   * base field, `metrics`, `env_vars`, `created`, `origin` — which is the admin
   * surface and deliberately not this dialog's eight fields. Pointing it at the
   * curated class would have replaced the admin form with the dialog for
   * everyone; a second route with its own form OPERATION leaves both intact.
   */
  public function testTheCuratedFormHasItsOwnWorkspaceRoute(): void {
    $route = $this->container->get('router.route_provider')->getRouteByName(self::ROUTE);

    self::assertSame('/_workspace/{bb_workspace}/ticket/create', $route->getPath());
    self::assertSame('bb_ticket.create', $route->getDefault('_entity_form'));
    // Added by BbWorkspaceRouteSubscriber to everything under the prefix, and
    // asserted here rather than assumed: without it the route would answer for
    // a workspace the account cannot read.
    self::assertSame('TRUE', $route->getRequirement('_bb_workspace_match'));
    self::assertFalse($route->getOption('_admin_route'), 'The dialog is a front-end surface.');
    self::assertSame('bb_ticket', $route->getRequirement('_entity_create_access'));
  }

  /**
   * …and that requirement resolves to `create bb_ticket`, both ways round.
   *
   * The negative half is the load-bearing one: it is the property
   * `BbShellIslandHost::accessIsland()` used to hold, and the claim of this
   * task is that moving it onto the route did not weaken it.
   */
  public function testTheCreateAccessHandlerTracksThePermission(): void {
    $handler = $this->container->get('entity_type.manager')->getAccessControlHandler('bb_ticket');
    // Uid 1 bypasses every check, so it must not be either actor.
    $this->newAccount([], 'uid1-dummy-route');
    $without = $this->newAccount([], 'no-create');
    $with = $this->newAccount(['create bb_ticket'], 'may-create');

    self::assertFalse($handler->createAccess(NULL, $without));
    self::assertTrue($handler->createAccess(NULL, $with));
  }

  /**
   * The entity declares `create` as a form operation, bound to the dialog.
   *
   * The route names `bb_ticket.create`; if the entity declared no such
   * handler, `EntityTypeManager::getFormObject()` would fall back to `default`
   * and the route would quietly render the ADMIN form inside the dialog hull.
   */
  public function testTheEntityDeclaresTheCreateFormOperation(): void {
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_ticket', 'create');

    self::assertInstanceOf(BbTicketCreateForm::class, $form);
  }

  /**
   * Creates a saved account holding exactly the given permissions.
   *
   * @param array<string> $permissions
   *   Permission machine names to grant.
   * @param string $name
   *   The account name.
   */
  private function newAccount(array $permissions, string $name): UserInterface {
    $account = $this->createUser($permissions, $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

}
