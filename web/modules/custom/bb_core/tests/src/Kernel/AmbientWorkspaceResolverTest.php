<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Access\BbActiveWorkspaceInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The active workspace is the URL, and nothing else (V1).
 *
 * BB-351 as corrected at the second coding gate: the chain is an ADD-FORM
 * route's `{bb_workspace}`, else nothing. The sole-membership link is gone —
 * it made one payload answerable two ways depending on the surface, and it gave
 * the browser an ambient workspace JSON:API never had.
 *
 * Two narrowings are asserted here rather than assumed, because both fail open
 * rather than loudly: a route that carries a workspace but is not an add form
 * is NOT create context, and an account's memberships are not a source at all.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class AmbientWorkspaceResolverTest extends KernelTestBase {

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
   * An add-form route's workspace parameter is the active workspace.
   */
  public function testAddFormRouteResolvesItsWorkspace(): void {
    $this->enterAddFormRouteWithWorkspace($this->fixture('b', 'bb_workspace'));

    self::assertSame(
      $this->fixture('b', 'bb_workspace')->id(),
      $this->activeWorkspace()->resolve()?->id(),
    );
    self::assertSame(
      BbActiveWorkspaceInterface::SOURCE_ROUTE,
      $this->activeWorkspace()->source(),
    );
  }

  /**
   * All four add routes are create context, not only the group one.
   *
   * The narrowing keys on the `_entity_form` default's operation, so a type
   * whose add form is registered differently would silently stop resolving.
   */
  public function testEveryWorkspaceBoundAddFormRouteResolvesItsWorkspace(): void {
    foreach (['bb_group', 'bb_team', 'bb_project', 'bb_ticket'] as $type) {
      $this->enterAddFormRouteWithWorkspace($this->fixture('a', 'bb_workspace'), $type);

      self::assertSame(
        $this->fixture('a', 'bb_workspace')->id(),
        $this->activeWorkspace()->resolve()?->id(),
        "The $type add form is create context.",
      );
    }
  }

  /**
   * A workspace-carrying route that is not an add form is not create context.
   *
   * The edit form carries `{bb_workspace}` exactly like the add form does.
   * Reading it as create context is what made every future workspace-carrying
   * route (edit, settings, members, a report) a workspace source by accident.
   */
  public function testEditFormRouteIsNotCreateContext(): void {
    $this->enterEditFormRouteWithWorkspace(
      $this->fixture('a', 'bb_workspace'),
      $this->fixture('a', 'bb_group'),
    );

    self::assertNull($this->activeWorkspace()->resolve());
    self::assertSame(
      BbActiveWorkspaceInterface::SOURCE_NONE,
      $this->activeWorkspace()->source(),
    );
  }

  /**
   * A single membership is not a workspace source (the deleted second link).
   *
   * This is the correction itself. The account below is a member of exactly
   * one workspace and stands on no route: under the delivered model that
   * resolved, which meant the same payload was answered one way in the browser
   * and another way on the API. It must now answer nothing.
   */
  public function testSingleMembershipDoesNotResolve(): void {
    $account = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    $this->container->get('account_switcher')->switchTo($account);

    self::assertNull($this->activeWorkspace()->resolve());
    self::assertSame(
      BbActiveWorkspaceInterface::SOURCE_NONE,
      $this->activeWorkspace()->source(),
    );
  }

  /**
   * No membership and no route is no context either.
   */
  public function testNoRouteResolvesNothing(): void {
    $this->container->get('account_switcher')
      ->switchTo($this->createAccount('ambient-stranger'));

    self::assertNull($this->activeWorkspace()->resolve());
    self::assertSame(
      BbActiveWorkspaceInterface::SOURCE_NONE,
      $this->activeWorkspace()->source(),
    );
  }

  /**
   * The administer bakers permission neither widens nor shortcuts it.
   *
   * The bypass belongs to the constraint's guard B, to the form's visibility
   * branch and to the selection plugins, never to the resolver. If this ever
   * resolves a workspace, the permission has leaked into context resolution.
   */
  public function testResolutionIsPermissionBlind(): void {
    $admin = $this->createAccount('ambient-admin', ['administer bakers']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $admin, ['member']);
    $this->container->get('account_switcher')->switchTo($admin);

    self::assertNull($this->activeWorkspace()->resolve());
    self::assertSame(
      BbActiveWorkspaceInterface::SOURCE_NONE,
      $this->activeWorkspace()->source(),
    );
  }

  /**
   * Returns the resolver under test.
   *
   * @return \Drupal\bb_core\Access\BbActiveWorkspaceInterface
   *   The active-workspace resolver.
   */
  private function activeWorkspace(): BbActiveWorkspaceInterface {
    $service = $this->container->get('bb_core.active_workspace');
    self::assertInstanceOf(BbActiveWorkspaceInterface::class, $service);
    return $service;
  }

}
