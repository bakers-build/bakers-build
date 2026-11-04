<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The projects screen's two lists are scoped to the workspace in the URL.
 *
 * AC 7, in the reading the operator settled: *"die projekte müssen aus der url
 * kommen"*. The distinction this class exists for is one the query-access layer
 * structurally cannot make. `BbWorkspaceReadScope::workspaceIds()` takes an
 * ACCOUNT and no workspace — it answers "what may this account see at all" and
 * returns the UNION of every OG membership. A user may belong to several
 * workspaces (via a direct membership, or via a team, since `og.settings`
 * registers `bb_team` as a group type too), and for such an account the union
 * is wider than the workspace named in the URL. Under `/a/projects` that showed
 * workspace B's projects: not a disclosure, because the account is entitled to
 * both rows, but the URL segment was decoration.
 *
 * SO THE NARROWING IS THE VIEW'S OWN ARGUMENT, and query access stays the
 * floor underneath it. That is the shape the living precedent already uses:
 * `views.view.bb_team_members` takes `entity_type`/`entity_id` with
 * `default_action: 'access denied'`, and `TeamMembers::build()` passes the
 * ambient team. Two layers answering two different questions — "may this
 * account see this row" and "is this row the one this URL asked for" — rather
 * than one layer asked to answer both.
 *
 * The account here is a member of BOTH workspaces, which is the only fixture in
 * which the two answers differ. An account with one membership passes an
 * unscoped view just as happily, which is why the previous suite could not see
 * this.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectsViewAmbientScopeTest extends KernelTestBase {

  use DanglingReferenceTrait;

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
    // Deleting an account touches `users_data`, which the entity schema does
    // not carry. The B1 regression below deletes a real account rather than
    // pointing the reference at a missing uid, because a dangling target is
    // the CONSEQUENCE under test and faking it would also hide the fact that
    // Drupal cleans up no such reference.
    $this->installSchema('user', ['users_data']);
    $this->buildTwoWorkspaceWorld();
    $this->installConfig(['views']);
    $this->installShippedView('views.view.projects');
    $this->installShippedView('views.view.groups');
  }

  /**
   * A member of two workspaces sees only the URL's workspace in the projects.
   *
   * THE LOAD-BEARING TEST OF THIS CLASS. Both rows are within the account's
   * read scope, so query access admits both and cannot be what separates them;
   * only the argument can.
   */
  public function testProjectsAreScopedToTheAmbientWorkspace(): void {
    $account = $this->memberOfBothWorkspaces();
    $this->container->get('account_switcher')->switchTo($account);

    $a = (string) $this->fixture('a', 'bb_workspace')->id();
    $b = (string) $this->fixture('b', 'bb_workspace')->id();

    $under_a = $this->viewResultIds('projects', [$a]);
    self::assertContains(
      (string) $this->fixture('a', 'bb_project')->id(),
      $under_a,
      "Workspace A's own project is missing from A's list.",
    );
    self::assertNotContains(
      (string) $this->fixture('b', 'bb_project')->id(),
      $under_a,
      "Workspace B's project appeared under workspace A's URL.",
    );

    $under_b = $this->viewResultIds('projects', [$b]);
    self::assertContains(
      (string) $this->fixture('b', 'bb_project')->id(),
      $under_b,
      "Workspace B's own project is missing from B's list.",
    );
    self::assertNotContains(
      (string) $this->fixture('a', 'bb_project')->id(),
      $under_b,
      "Workspace A's project appeared under workspace B's URL.",
    );
  }

  /**
   * The same, for the Groups block.
   *
   * `bb_group.workspace_id` is a single hop, so this argument needs no
   * relationship — unlike the projects one, which walks `group_id` because
   * `bb_project` carries no workspace field at all.
   */
  public function testGroupsAreScopedToTheAmbientWorkspace(): void {
    $account = $this->memberOfBothWorkspaces();
    $this->container->get('account_switcher')->switchTo($account);

    $a = (string) $this->fixture('a', 'bb_workspace')->id();

    $under_a = $this->viewResultIds('groups', [$a]);
    self::assertContains(
      (string) $this->fixture('a', 'bb_group')->id(),
      $under_a,
      "Workspace A's own group is missing from A's list.",
    );
    self::assertNotContains(
      (string) $this->fixture('b', 'bb_group')->id(),
      $under_a,
      "Workspace B's group appeared under workspace A's URL.",
    );
  }

  /**
   * With no workspace in the URL both views return nothing.
   *
   * `default_action: 'access denied'` rather than `default: all`, and the
   * difference is the whole tenancy property: a view that fell back to "all"
   * would list every workspace's rows the moment a route stopped supplying the
   * parameter, which is exactly how an ambient-scoping bug becomes a
   * disclosure. Nothing guards it a second time: this screen has no island, so
   * the view's own default action is the only thing standing between a route
   * change and a leak.
   */
  public function testNoWorkspaceArgumentYieldsNoRows(): void {
    $account = $this->memberOfBothWorkspaces();
    $this->container->get('account_switcher')->switchTo($account);

    self::assertSame([], $this->viewResultIds('projects'));
    self::assertSame([], $this->viewResultIds('groups'));
  }

  /**
   * A project whose owner account was deleted stays in its workspace's list.
   *
   * THE B1 REGRESSION, WITH ITS REASON CORRECTED. This docblock used to say
   * that `BbProject::owner_user_id` "is not `setRequired(TRUE)` — it sets a
   * label, a target type and a default-value callback". That is FALSE: the
   * field has carried `setRequired(TRUE)` since `66780aa93`. The behaviour
   * under test does not change, and neither does the `required: false`
   * relationship it measures — because `setRequired()` is a VALIDATION
   * constraint on a write to the project and NOT delete protection on the
   * account it references. `bb_core` guards that nowhere — no `preDelete`,
   * no cascade, no reference constraint — so delete the account that owns a
   * project and the reference is left dangling; a `required: true`
   * relationship is then an INNER JOIN that drops the whole project from the
   * workspace's primary listing with no message, no empty cell and no row.
   * `views.view.groups` already declared `required: false` for the
   * byte-identical `BbGroup::owner_user_id`, so the two views disagreed about
   * the same fact and the projects view took the losing side.
   *
   * The row is asserted, not the cell: an empty Owner cell is what a LEFT JOIN
   * produces and the row is what the operator lost.
   */
  public function testProjectSurvivesItsOwnerAccountBeingDeleted(): void {
    $orphan_owner = $this->createAccount('doomed-owner');
    $project = $this->createEntity('bb_project', [
      'name' => 'project-a-orphaned-owner',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
      'owner_user_id' => $orphan_owner->id(),
    ]);
    $orphan_owner->delete();

    $account = $this->createAccount('scope-bypasser', [
      'administer bakers', 'view bb_project',
    ]);
    $this->container->get('account_switcher')->switchTo($account);

    self::assertContains(
      (string) $project->id(),
      $this->viewResultIds('projects', [(string) $this->fixture('a', 'bb_workspace')->id()]),
      'A project whose owner account was deleted vanished from the list.',
    );
  }

  /**
   * A project whose group was deleted is in NO workspace's list, by design.
   *
   * A PIN RATHER THAN A REGRESSION — it is green before and after the ambient
   * argument, and it is here so the asymmetry with the owner case above is a
   * recorded decision instead of an accident. The projects view reaches the
   * workspace only through `group_id` (`bb_project` has no workspace field),
   * so a project whose group is gone has no workspace to be listed under. The
   * two honest options are "no workspace" and "every workspace"; a
   * URL-scoped list must choose the first.
   *
   * `BbProject::group_id` IS `setRequired(TRUE)`, so this state is only
   * reachable by deleting a group out from under its projects, which
   * `bb_core` guards nowhere — no `preDelete`, no cascade, no reference
   * constraint. That is a data-integrity gap and it is named in the view's own
   * `description`; it is not this listing's to paper over.
   */
  public function testProjectWithDeletedGroupIsListedNowhere(): void {
    $group = $this->createEntity('bb_group', [
      'name' => 'group-a-doomed',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
      'owner_user_id' => $this->createAccount('doomed-group-owner')->id(),
    ]);
    $project = $this->createEntity('bb_project', [
      'name' => 'project-a-orphaned-group',
      'group_id' => $group->id(),
      'owner_user_id' => $this->createAccount('surviving-owner')->id(),
    ]);
    $this->removeRowsOnly($group);

    $account = $this->createAccount('scope-bypasser', [
      'administer bakers', 'view bb_project',
    ]);
    $this->container->get('account_switcher')->switchTo($account);

    foreach (['a', 'b'] as $side) {
      self::assertNotContains(
        (string) $project->id(),
        $this->viewResultIds('projects', [(string) $this->fixture($side, 'bb_workspace')->id()]),
        "A project with no group appeared under workspace $side.",
      );
    }
  }

  /**
   * The page display scopes by workspace slug.
   */
  public function testPageDisplayScopesByWorkspaceSlug(): void {
    $account = $this->memberOfBothWorkspaces();
    $this->container->get('account_switcher')->switchTo($account);
    $this->ensureWorkspaceSlugs();

    $a_slug = $this->workspaceSlug('a');
    $under_a_projects = $this->viewResultIds('projects', [$a_slug], 'workspace_list');
    self::assertContains((string) $this->fixture('a', 'bb_project')->id(), $under_a_projects);
    self::assertNotContains((string) $this->fixture('b', 'bb_project')->id(), $under_a_projects);

    $under_a_groups = $this->viewResultIds('groups', [$a_slug], 'workspace_list');
    self::assertContains((string) $this->fixture('a', 'bb_group')->id(), $under_a_groups);
    self::assertNotContains((string) $this->fixture('b', 'bb_group')->id(), $under_a_groups);
  }

  /**
   * A partial title keeps only matching rows in that workspace.
   */
  public function testPageTitleContainsFilterIsWorkspaceScoped(): void {
    $account = $this->memberOfBothWorkspaces();
    $this->container->get('account_switcher')->switchTo($account);
    $this->ensureWorkspaceSlugs();

    $alpha_project = $this->createEntity('bb_project', [
      'name' => 'Alpha North',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
      'owner_user_id' => $account->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
    ]);
    $beta_project = $this->createEntity('bb_project', [
      'name' => 'Beta South',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
      'owner_user_id' => $account->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
    ]);
    $foreign_alpha = $this->createEntity('bb_project', [
      'name' => 'Alpha Other',
      'group_id' => $this->fixture('b', 'bb_group')->id(),
      'owner_user_id' => $account->id(),
      'teams' => [$this->fixture('b', 'bb_team')->id()],
    ]);
    $alpha_group = $this->createEntity('bb_group', [
      'name' => 'Alpha Billing',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
      'owner_user_id' => $account->id(),
    ]);
    $beta_group = $this->createEntity('bb_group', [
      'name' => 'Beta Billing',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
      'owner_user_id' => $account->id(),
    ]);

    $a_slug = $this->workspaceSlug('a');
    $projects = $this->viewResultIds('projects', [$a_slug], 'workspace_list', ['title' => 'Alpha']);
    self::assertContains((string) $alpha_project->id(), $projects);
    self::assertNotContains((string) $beta_project->id(), $projects);
    self::assertNotContains((string) $foreign_alpha->id(), $projects);

    $groups = $this->viewResultIds('groups', [$a_slug], 'workspace_list', ['title' => 'Alpha']);
    self::assertContains((string) $alpha_group->id(), $groups);
    self::assertNotContains((string) $beta_group->id(), $groups);

    $cleared = $this->viewResultIds('projects', [$a_slug], 'workspace_list', ['title' => '']);
    self::assertContains((string) $alpha_project->id(), $cleared);
    self::assertContains((string) $beta_project->id(), $cleared);
  }

  /**
   * Literal %, _ and apostrophes in a title stay data, not LIKE syntax.
   */
  public function testTitleContainsTreatsSpecialCharactersAsData(): void {
    $account = $this->memberOfBothWorkspaces();
    $this->container->get('account_switcher')->switchTo($account);
    $this->ensureWorkspaceSlugs();

    $percent = $this->createEntity('bb_project', [
      'name' => '100% complete',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
      'owner_user_id' => $account->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
    ]);
    $underscore = $this->createEntity('bb_project', [
      'name' => 'under_score',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
      'owner_user_id' => $account->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
    ]);
    $apostrophe = $this->createEntity('bb_project', [
      'name' => "O'Brien",
      'group_id' => $this->fixture('a', 'bb_group')->id(),
      'owner_user_id' => $account->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
    ]);
    $decoy = $this->createEntity('bb_project', [
      'name' => 'underXscore',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
      'owner_user_id' => $account->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
    ]);

    $a_slug = $this->workspaceSlug('a');
    $percent_hits = $this->viewResultIds('projects', [$a_slug], 'workspace_list', ['title' => '100%']);
    self::assertSame([(string) $percent->id()], $percent_hits);

    $underscore_hits = $this->viewResultIds('projects', [$a_slug], 'workspace_list', ['title' => 'under_score']);
    self::assertContains((string) $underscore->id(), $underscore_hits);
    self::assertNotContains((string) $decoy->id(), $underscore_hits);

    $apostrophe_hits = $this->viewResultIds('projects', [$a_slug], 'workspace_list', ['title' => "O'Brien"]);
    self::assertSame([(string) $apostrophe->id()], $apostrophe_hits);
  }

  /**
   * Missing, invalid and the "all" exception value fail closed on the page.
   *
   * Empty arguments are covered on the default display; the page display's
   * exposed form cannot generate a URL without a workspace slot, so the leak
   * to close here is a supplied value that used to mean "every workspace".
   */
  public function testPageDisplayRejectsTheAllShortcut(): void {
    $account = $this->memberOfBothWorkspaces();
    $this->container->get('account_switcher')->switchTo($account);

    foreach (['projects', 'groups'] as $view_id) {
      $view = Views::getView($view_id);
      self::assertNotNull($view);
      $view->setDisplay('workspace_list');
      $options = $view->display_handler->getOption('arguments')['workspace_id'] ?? [];
      self::assertSame('', $options['exception']['value'] ?? 'all');
      self::assertSame('bb_workspace_reference', $options['validate']['type'] ?? NULL);
    }

    self::assertSame([], $this->viewResultIds('projects', ['no-such-workspace'], 'workspace_list'));
    self::assertSame([], $this->viewResultIds('groups', ['no-such-workspace'], 'workspace_list'));
    self::assertSame([], $this->viewResultIds('projects', ['all'], 'workspace_list'));
    self::assertSame([], $this->viewResultIds('groups', ['all'], 'workspace_list'));
  }

  /**
   * An account whose memberships span both workspaces.
   *
   * Direct workspace memberships plus a team membership per side (BB-462
   * D4/D7), because `BbWorkspaceReadScope` derives project visibility from
   * team membership or a see-all workspace role and NOT from workspace
   * membership alone — without the team memberships the read scope would
   * hide both rows and the negatives above would pass for the wrong reason.
   */
  private function memberOfBothWorkspaces(): UserInterface {
    $account = $this->createAccount('two-workspace-member', [
      'view bb_project', 'view bb_group',
    ]);
    foreach (['a', 'b'] as $side) {
      $this->addMembership($this->fixture($side, 'bb_workspace'), $account, ['member']);
      $this->addMembership($this->fixture($side, 'bb_team'), $account, []);
    }
    return $account;
  }

  /**
   * Pins a public slug on each fixture workspace.
   */
  private function ensureWorkspaceSlugs(): void {
    foreach (['a' => 'workspace-a', 'b' => 'workspace-b'] as $side => $slug) {
      $workspace = $this->fixture($side, 'bb_workspace');
      self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
      if ($workspace->getSlug() !== $slug) {
        $workspace->setSlug($slug)->save();
      }
    }
  }

  /**
   * The public slug of one fixture workspace.
   */
  private function workspaceSlug(string $side): string {
    $workspace = $this->fixture($side, 'bb_workspace');
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    return $workspace->getSlug();
  }

}
