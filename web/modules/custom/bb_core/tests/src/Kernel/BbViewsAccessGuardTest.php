<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Yaml\Yaml;

/**
 * The PM-facing Views keep returning rows once query access is declared.
 *
 * `bb_conductors` (base bb_conductor) and `active_tickets` (base
 * bb_ticket) are unaffected by BB-305 only because the dashboard's audience
 * ALSO holds `view bb_conductor` and `view bb_ticket`. That is a condition,
 * not a guarantee: trim whatever carries those two and these Views go empty
 * rather than lose a column, with HTTP 200 and no log line. This test names the
 * cause instead of presenting an empty dashboard (spec V6).
 *
 * BB-359 is the first time that condition was actually tested: the audience
 * used to be the site-wide `bb_project_manager` role, which D6 deleted, and
 * is now the workspace `member` rank — which carries both permissions, so the
 * guarantee survives the move. The account below is still built by granting the
 * permissions site-wide, deliberately: this test is about what the Views do
 * with a given permission set, not about where the set came from.
 *
 * MIGRATED by BB-378, not weakened. The bb_conductor case used to run on
 * `nodes`, which was deleted with `bb_theme:node-row` — the component it
 * rendered, reachable from no Designbook scene. `bb_conductors` is the other
 * shipped View over the same base table, ships from the same `config/install`,
 * and renders plain fields rather than an SDC, so the QUERY this test exercises
 * is identical: same base entity type, same query-access conditions, same
 * `bb_conductor_access` tag. Note the one honest difference: `nodes` was
 * gated on `access bakers dashboard` and `bb_conductors` is gated on
 * `administer bakers`. It does not affect the assertion, because
 * ::importFixtureView() + ::execute() deliberately bypass the access plugin
 * (only the query is under test), but a future test that DOES render through
 * the access layer must not assume a workspace member reaches this View.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbViewsAccessGuardTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  /**
   * The workspace every row of this test belongs to.
   */
  private ContentEntityInterface $sharedWorkspace;

  /**
   * The project every row of this test belongs to.
   */
  private ContentEntityInterface $sharedProject;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'views', 'block', 'ui_patterns', 'ui_patterns_views',
    'ui_patterns_field_formatters', 'better_exposed_filters',
    'views_autocomplete_filters', 'display_builder', 'display_builder_entity_view',
    'field', 'og',
    'display_builder_page_layout', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_project',
      'bb_conductor', 'bb_ticket',
      'bb_run', 'bb_comment', 'bb_environment', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    // The recipe owns these vocabularies, so a Kernel test must create them
    // itself: ui_patterns builds a sample bb_ticket while calculating the
    // View's dependencies, and that sample references a bb_term bundle.
    foreach (['type', 'recipe', 'label'] as $vid) {
      $this->container->get('entity_type.manager')->getStorage('bb_vocabulary')
        ->create(['id' => $vid, 'label' => $vid])->save();
    }
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'uid1-dummy', 'status' => 1])->save();
  }

  /**
   * Imports one View fixture so the Kernel test can execute it.
   *
   * The View is seeded from a committed fixture rather than hand-built, so the
   * thing under test is a real View's config byte for byte. The fixtures are
   * `bb_dashboard`'s former `config/install` objects, rehomed under
   * `bb_core/tests/fixtures/views/` when BB-396 deleted that module.
   *
   * `bb_dashboard` is NOT installed, and no longer needs to be: it used to be
   * what gave bakers.build entities their `views_data` handler, through
   * `hook_entity_type_alter()`, and that is now declared per entity type on the
   * entity classes themselves (`BbTicket`'s `views_data` handler, and its
   * siblings). Re-adding a dependency on the module would not just be dead — it
   * would not resolve.
   *
   * It is written through the config factory rather than the View entity API on
   * purpose. Saving a View runs calculateDependencies(), which asks the
   * ui_patterns row plugin for a sample bb_ticket; generating one emits
   * dozens of PHP warnings from contrib state_machine, and phpunit.xml sets
   * failOnWarning. None of that is under test here: only the query is, and
   * ::execute() reaches it without the dependency pass.
   *
   * @param string $view_id
   *   The View's config id, e.g. `nodes`.
   */
  private function importFixtureView(string $view_id): void {
    $path = $this->root . '/' . $this->container->get('extension.list.module')->getPath('bb_core')
      . '/tests/fixtures/views/views.view.' . $view_id . '.yml';
    $this->assertFileExists($path);
    $values = Yaml::parseFile($path);
    unset($values['_core']);
    $values['uuid'] = $this->container->get('uuid')->generate();
    $this->config('views.view.' . $view_id)->setData($values)->save();
  }

  /**
   * Creates a user holding the permissions the dashboard's audience holds.
   *
   * @return \Drupal\user\UserInterface
   *   The saved account.
   */
  private function createProjectManager(): UserInterface {
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => 'pm', 'label' => 'pm'])->save();
    user_role_grant_permissions('pm', [
      'access bakers dashboard',
      'view bb_conductor',
      'view bb_ticket',
    ]);
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'pm-user', 'status' => 1, 'roles' => ['pm']]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    // BB-318: the permission alone no longer decides. The account also needs
    // a membership covering the rows, and the `admin` role on the workspace is
    // the shape a project manager actually has — it reaches every project of
    // the workspace without a per-project membership.
    $this->addMembership($this->workspace(), $user, ['lead']);
    return $user;
  }

  /**
   * Returns the workspace every row of this test belongs to, creating it once.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The workspace.
   */
  private function workspace(): ContentEntityInterface {
    if (!isset($this->sharedWorkspace)) {
      $storage = $this->container->get('entity_type.manager');
      $workspace = $storage->getStorage('bb_workspace')->create(['name' => 'w']);
      $workspace->save();
      $this->assertInstanceOf(ContentEntityInterface::class, $workspace);
      $this->sharedWorkspace = $workspace;
    }
    return $this->sharedWorkspace;
  }

  /**
   * Returns the project every row of this test belongs to, creating it once.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The project.
   */
  private function project(): ContentEntityInterface {
    if (!isset($this->sharedProject)) {
      $storage = $this->container->get('entity_type.manager');
      $group = $storage->getStorage('bb_group')
        ->create(['name' => 'g', 'workspace_id' => $this->workspace()->id()]);
      $group->save();
      $project = $storage->getStorage('bb_project')
        ->create(['name' => 'p', 'group_id' => $group->id()]);
      $project->save();
      $this->assertInstanceOf(ContentEntityInterface::class, $project);
      $this->sharedProject = $project;
    }
    return $this->sharedProject;
  }

  /**
   * The conductor-based View still returns its row for the project manager.
   */
  public function testConductorViewStillReturnsRowsForProjectManager(): void {
    $this->importFixtureView('bb_conductors');
    $pm = $this->createProjectManager();
    $other = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'someone-else', 'status' => 1]);
    $other->save();

    $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => 'foreign',
      'label' => 'foreign',
      'owner_user_id' => $other->id(),
      'project_id' => $this->project()->id(),
    ])->save();

    $this->container->get('account_switcher')->switchTo($pm);
    $view = Views::getView('bb_conductors');
    $this->assertNotNull($view, 'The `bb_conductors` view exists.');
    $view->execute();
    $this->container->get('account_switcher')->switchBack();

    $this->assertCount(
      1,
      $view->result,
      'The dashboard audience holds `view bb_conductor`, so the View is unfiltered. '
      . 'If this fails, the role lost that permission and the dashboard is empty.',
    );
  }

  /**
   * The ticket-based dashboard View still returns rows for the project manager.
   */
  public function testActiveTicketsViewStillReturnsRowsForProjectManager(): void {
    $this->importFixtureView('active_tickets');
    $pm = $this->createProjectManager();
    $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'title' => 'visible',
        'state' => 'backlog',
        'project_id' => $this->project()->id(),
      ])->save();

    $this->container->get('account_switcher')->switchTo($pm);
    $view = Views::getView('active_tickets');
    $this->assertNotNull($view, 'The `active_tickets` view exists.');
    $view->execute();
    $this->container->get('account_switcher')->switchBack();

    $this->assertNotEmpty(
      $view->result,
      'The dashboard audience holds `view bb_ticket`, so the View is unfiltered. '
      . 'If this fails, the role lost that permission and the dashboard is empty.',
    );
  }

}
