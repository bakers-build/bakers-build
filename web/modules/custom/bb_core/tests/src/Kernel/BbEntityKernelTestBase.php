<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Symfony\Component\HttpFoundation\Request;

/**
 * Base class for Kernel tests that need the whole bakers.build entity graph.
 *
 * Installs every bakers entity schema and the bb_core config, then acts as an
 * account inside a workspace. The bb_labels / bb_capability_tags
 * vocabularies are created explicitly because the bakers recipe — not bb_core —
 * owns them in production.
 *
 * It was `DashboardKernelTestBase` until BB-396 retired `bb_dashboard`. Two
 * things went with that module and are recorded because the comments below
 * still explain schemas in terms of them: it no longer installs the dashboard's
 * config, and the sample-entity renders that made several of those schemas
 * mandatory no longer run. The schemas are kept anyway — the entity graph is
 * what the surviving tests exercise, and installing one table too many is
 * cheaper than a missing-table error that takes a whole suite with it.
 */
abstract class BbEntityKernelTestBase extends KernelTestBase {

  use UserCreationTrait;

  /**
   * The slug of the workspace these tests render inside.
   */
  protected const WORKSPACE_SLUG = 'acme';

  /**
   * The workspace these tests render inside.
   */
  protected ?BbWorkspaceInterface $hostWorkspace = NULL;

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'file', 'image',
    'system',
    'user',
    'field',
    'options',
    'text',
    'link',
    'filter',
    'markdown_easy',
    'entity',
    'state_machine',
    'views',
    'better_exposed_filters',
    'views_autocomplete_filters',
    'ui_patterns',
    'ui_patterns_views',
    'ui_patterns_field',
    'ui_patterns_field_formatters',
    'field_ui',
    'display_builder',
    'display_builder_entity_view',
    // `og` carries the config schema for the og.og_role.* entities bb_core
    // ships in config/install (BB-316); installConfig(['bb_core']) below
    // aborts without it. A kernel test enables exactly the modules it lists.
    'og',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    // bb_core resolves an OG read scope for every access-checked query, and
    // bb_core's own config install runs them too. Without the table that
    // resolution dies with a missing-table SQL error during installConfig() —
    // the whole suite, not one test.
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('bb_group');
    // bb_group.workspace_id references bb_workspace (BB-316); the
    // dashboard config install resolves that reference while generating its
    // sample entities, so the workspace table must exist or the install fails
    // with a missing-table SQL error.
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_ticket');
    // The dashboard config install renders a board_card sample via
    // display_builder, which queries bb_comment (the ticket's comment feed);
    // its schema must exist.
    $this->installEntitySchema('bb_comment');
    $this->installEntitySchema('bb_conductor');
    // Conductor.machine references bb_machine (BB-353); sample/view
    // dependency calculation can resolve the ER target type.
    $this->installEntitySchema('bb_machine');
    $this->installEntitySchema('bb_run');
    $this->installEntitySchema('bb_term');
    // The dashboard config install generates a sample bb_ticket whose
    // computed `environments` field queries bb_environment; its schema must
    // exist or the sample render fatals with a missing-table SQL error.
    $this->installEntitySchema('bb_environment');
    $this->installConfig(['bb_core']);
    // bb_core no longer ships these vocabularies (the bakers recipe owns them);
    // create the bundles the bb_ticket label reference needs before the
    // dashboard Views config (which generates a sample bb_ticket) installs.
    BbVocabulary::create(['id' => 'bb_labels', 'label' => 'bakers.build labels'])->save();
    BbVocabulary::create(['id' => 'bb_capability_tags', 'label' => 'bakers.build capability tags'])->save();
    \Drupal::service('entity_type.bundle.info')->clearCachedBundles();
    // Since BB-305 every bakers.build entity declares a query_access handler, so a
    // View executes an access-checked query and an account with no permissions
    // sees an empty result. The dashboard's audience is the workspace `member`
    // rank, which holds these since BB-359 replaced the bb_project_manager
    // role with it; act as an equivalent account so these tests keep measuring
    // filtering, paging and rendering rather than read access. Granting the
    // permissions site-wide rather than through a rank is deliberate here — it
    // keeps the fixture free of a tenancy these tests are not about.
    // BbViewsAccessGuardTest is what pins the permission set itself.
    $this->setUpCurrentUser([], [
      'access bakers dashboard',
      'view bb_ticket',
      'view bb_conductor',
      'view bb_project',
      'view bb_run',
      'view bb_comment',
      'view bb_term',
      'view bb_environment',
      'view bb_group',
      // BB-318 narrows every one of those reads to the account's OG scope,
      // and this account holds no membership. The type-level admin permission
      // bypasses the narrowing, which restores exactly what the paragraph
      // above says this suite is for. Only visible since the og_membership
      // schema is installed: before that the scope resolution died with a
      // missing-table error and took the whole suite with it.
      'administer bakers',
    ]);
    $this->enterWorkspace();
  }

  /**
   * Puts the request inside a workspace, as every product render is.
   *
   * Since BB-350 every front-end route carries a workspace slug, and code
   * that builds a URL reads the workspace as AMBIENT rather than being handed
   * it — BbWorkspaceRouteProcessor takes it off the current route match. A
   * kernel test calling such code directly has no ambient anything, so the
   * workspace has to be staged.
   *
   * The route it stages used to be `bb_dashboard.overview`, which BB-396
   * deleted with that module. Any workspace-prefixed route serves: what matters
   * is that the request carries a route match with a `bb_workspace`
   * parameter, not which screen it points at. `entity.bb_team.canonical` is
   * used because it is the reference surface and cannot quietly disappear
   * without this base failing loudly.
   */
  protected function enterWorkspace(): void {
    $etm = $this->container->get('entity_type.manager');
    $workspace = $etm->getStorage('bb_workspace')
      ->create(['name' => 'Acme', 'slug' => self::WORKSPACE_SLUG]);
    $workspace->save();
    $this->assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->hostWorkspace = $workspace;

    $this->container->get('router.builder')->rebuild();
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_team.canonical');
    $request = Request::create('/' . self::WORKSPACE_SLUG . '/team/1');
    // Carry the harness's session over: anything reading the current user off
    // the request would otherwise hit SessionNotFoundException on this one.
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, 'entity.bb_team.canonical');
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('bb_workspace', $workspace);
    $this->container->get('request_stack')->push($request);
  }

}
