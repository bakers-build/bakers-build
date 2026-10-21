<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The projects screen's two views are scoped to the account's workspace.
 *
 * AC 7, and it is asserted rather than implemented: `BbProject` and
 * `BbGroup` both declare `query_access => QueryAccessHandler::class`, and
 * `WorkspaceReadScopeSubscriber` narrows the result to the account's OG read
 * scope. Nothing in this ticket filters anything. What this class measures is
 * that the layer actually reaches a VIEWS query — a property nothing observed
 * before, because before BB-411 no view queried either base table, and
 * indeed neither base table was reachable by Views at all.
 *
 * A REGRESSION HERE IS A DISCLOSURE, not a poorer screen, which is why the
 * negative is the load-bearing assertion. The account is deliberately NOT root:
 * root bypasses query access, so a root run would pass with the scope gone.
 *
 * The world is `WorkspaceReadScopeTestTrait`'s rather than a third way of
 * seeding a membership — two disjoint workspaces, each with one project under
 * one group, and an account whose only membership is in the first.
 *
 * EVERY NEGATIVE HERE IS MEASURED UNDER THE FOREIGN WORKSPACE'S OWN ARGUMENT,
 * and that is what keeps this class about query access. Since BB-411's
 * ambient scoping both views take a workspace argument, so asking for
 * workspace A and not finding B's row would prove only that the argument
 * works — the row was never a candidate. Asking for workspace B, as an account
 * that is not a member of B, makes the argument admit the row and leaves query
 * access as the only thing that can refuse it. Ambient scoping is a different
 * property with its own class (`ProjectsViewAmbientScopeTest`).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectsViewTenancyTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;
  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'views', 'better_exposed_filters',
    // `views.view.projects` composes a `display_builder` sources tree since
    // BB-421 D9, and this class SAVES that view. A save is what the config
    // schema is checked on, so the module owning
    // `views.display_extender.display_builder` has to be enabled — which is
    // also why the file left `bb_core/config/optional` (`CLAUDE.md`: a module
    // may not ship config whose schema comes from a non-dependency).
    'ui_patterns', 'ui_patterns_views', 'display_builder',
    'display_builder_views',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    // The two views ship in bb_core's config/optional, which installConfig()
    // does not read. Installing them by name is what makes them exist here.
    $this->installConfig(['views']);
    $this->installShippedView('views.view.projects');
    $this->installShippedView('views.view.groups');
  }

  /**
   * A project of another workspace is not in the projects view's result.
   */
  public function testProjectsViewShowsOnlyTheAccountsWorkspace(): void {
    $account = $this->createAccount('projects-reader', ['view bb_project']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);
    $this->container->get('account_switcher')->switchTo($account);

    self::assertContains(
      (string) $this->fixture('a', 'bb_project')->id(),
      $this->viewResultIds('projects', [(string) $this->fixture('a', 'bb_workspace')->id()]),
      "The account's own project is missing from its own list.",
    );
    // Workspace B's OWN argument, so the argument admits B's row and only the
    // read scope can refuse it.
    self::assertNotContains(
      (string) $this->fixture('b', 'bb_project')->id(),
      $this->viewResultIds('projects', [(string) $this->fixture('b', 'bb_workspace')->id()]),
      'A project of another workspace reached this list.',
    );
  }

  /**
   * A group of another workspace is not in the groups view's result.
   */
  public function testGroupsViewShowsOnlyTheAccountsWorkspace(): void {
    $account = $this->createAccount('groups-reader', ['view bb_group']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    $this->container->get('account_switcher')->switchTo($account);

    self::assertContains(
      (string) $this->fixture('a', 'bb_group')->id(),
      $this->viewResultIds('groups', [(string) $this->fixture('a', 'bb_workspace')->id()]),
      "The account's own group is missing from its own list.",
    );
    self::assertNotContains(
      (string) $this->fixture('b', 'bb_group')->id(),
      $this->viewResultIds('groups', [(string) $this->fixture('b', 'bb_workspace')->id()]),
      'A group of another workspace reached this list.',
    );
  }

  /**
   * Both workspaces' rows are reachable through the views by someone.
   *
   * THE NON-VACUITY GUARD for the two negatives above, and it is the reason
   * they mean anything. `assertNotContains` passes just as happily when the
   * other workspace's row is missing for a reason that has nothing to do with
   * tenancy — a broken relationship, a required join dropping the row, a view
   * that returns nothing at all. An `administer bakers` holder bypasses the read
   * scope, so seeing BOTH rows here proves the rows are reachable and the
   * views work, which leaves the scope as the only explanation for the
   * negatives.
   *
   * Each row is asked for under ITS OWN workspace argument, so this guard
   * proves the argument admits the row as well — without that, a negative
   * above could be the argument's doing and this guard would not notice.
   */
  public function testBothWorkspacesRowsAreReachableWithoutTheScope(): void {
    $account = $this->createAccount('scope-bypasser', [
      'administer bakers', 'view bb_project', 'view bb_group',
    ]);
    $this->container->get('account_switcher')->switchTo($account);

    $b_workspace = (string) $this->fixture('b', 'bb_workspace')->id();

    self::assertContains(
      (string) $this->fixture('b', 'bb_project')->id(),
      $this->viewResultIds('projects', [$b_workspace]),
      "Workspace B's project is unreachable even without the scope, so the negative above proves nothing.",
    );
    self::assertContains(
      (string) $this->fixture('b', 'bb_group')->id(),
      $this->viewResultIds('groups', [$b_workspace]),
      "Workspace B's group is unreachable even without the scope, so the negative above proves nothing.",
    );

    // The account's own side too, so a failure says which half broke.
    $a_workspace = (string) $this->fixture('a', 'bb_workspace')->id();
    self::assertContains(
      (string) $this->fixture('a', 'bb_project')->id(),
      $this->viewResultIds('projects', [$a_workspace]),
    );
    self::assertContains(
      (string) $this->fixture('a', 'bb_group')->id(),
      $this->viewResultIds('groups', [$a_workspace]),
    );
  }

}
