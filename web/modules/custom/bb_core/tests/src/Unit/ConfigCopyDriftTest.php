<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Component\Utility\SortArray;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * Asserts the two shipped copies of the OG role config cannot drift (V4).
 *
 * BB-316 D3 ships the six og.og_role.* configs twice, because the project has
 * two install paths: the server imports config/sync via CIM, a fresh or test
 * site gets bb_core/config/install through the recipe's config.import. Two
 * files, one meaning — so they have to be compared by something.
 *
 * The comparison strips `uuid` and `_core` from the config/sync side (D4) and
 * sorts keys recursively, which is exactly the normalisation core's
 * ConfigConfigurator applies before it decides a recipe's imported config
 * collides with the active config. Comparing bytes instead would fail on the
 * comment header alone.
 *
 * Runs without a bootstrapped site: both directories are resolved from __DIR__.
 */
#[Group('bb_core')]
final class ConfigCopyDriftTest extends UnitTestCase {

  /**
   * The nine role config names, without the .yml extension.
   *
   * Five workspace roles (BB-316, BB-462 D1/D2/D9) and four team roles
   * (BB-321, BB-456 D9, BB-462 D3): the property asserted is identical
   * for all of them, so the list grows rather than a second test class being
   * written (BB-317 D3). bb_project's three roles are GONE — BB-462 D7
   * deregisters it as an OG group and deletes them from both config paths.
   * The workspace `app` role is also GONE — BB-462 D9 removes it entirely
   * rather than relocating it, so there is nothing left here to compare for
   * either.
   *
   * @var array<string>
   */
  private const ROLE_CONFIG_NAMES = [
    'og.og_role.bb_workspace-bb_workspace-non-member',
    'og.og_role.bb_workspace-bb_workspace-member',
    'og.og_role.bb_workspace-bb_workspace-contributor',
    'og.og_role.bb_workspace-bb_workspace-lead',
    'og.og_role.bb_workspace-bb_workspace-guest',
    'og.og_role.bb_team-bb_team-non-member',
    'og.og_role.bb_team-bb_team-member',
    // The team lead rank (BB-456 spec D9): the only rank that can hold the
    // two team-scoped statistic permissions.
    'og.og_role.bb_team-bb_team-lead',
    // The team owner rank (BB-462 D3): who may join the team, and its own
    // settings.
    'og.og_role.bb_team-bb_team-owner',
  ];

  /**
   * The surviving OAuth2 scope's per-permission children (BB-391).
   *
   * The umbrella's children ARE the ceiling of every bakers.build machine
   * identity, so the pair has to be compared STRUCTURALLY and not only by the
   * permission each child names: a child that drifts in `status`, in
   * `grant_types.client_credentials.status` or in `parent` still names the
   * right permission and grants nothing, and
   * `Oauth2ScopeProvider::getPermissions()` would simply return a shorter union
   * on one install path than on the other.
   *
   * Listed rather than globbed on purpose. A glob over one directory compares
   * only the files that directory happens to hold, so deleting a child from
   * BOTH paths — the drift AC6 is about — would leave the pair perfectly
   * consistent and perfectly wrong. The exact SET is pinned by
   * `SiteWideRoleResidueTest::testTheOneScopeIsAnUmbrellaOverPermissions()`;
   * what is pinned here is that each named object exists twice and agrees.
   *
   * @var array<string>
   */
  private const SCOPE_CONFIG_NAMES = [
    'simple_oauth.oauth2_scope.bb_session',
    'simple_oauth.oauth2_scope.bb_session_access_content',
    'simple_oauth.oauth2_scope.bb_session_claim_bakers_tickets',
    'simple_oauth.oauth2_scope.bb_session_create_bb_comment',
    'simple_oauth.oauth2_scope.bb_session_create_bb_environment',
    'simple_oauth.oauth2_scope.bb_session_create_bb_group',
    'simple_oauth.oauth2_scope.bb_session_create_bb_project',
    'simple_oauth.oauth2_scope.bb_session_create_bb_team',
    'simple_oauth.oauth2_scope.bb_session_create_bb_term',
    'simple_oauth.oauth2_scope.bb_session_create_bb_ticket',
    'simple_oauth.oauth2_scope.bb_session_edit_bb_project',
    'simple_oauth.oauth2_scope.bb_session_register_bakers_conductor',
    'simple_oauth.oauth2_scope.bb_session_update_any_bb_group',
    'simple_oauth.oauth2_scope.bb_session_update_any_bb_term',
    'simple_oauth.oauth2_scope.bb_session_update_any_bb_ticket',
    'simple_oauth.oauth2_scope.bb_session_update_any_bb_workspace',
    'simple_oauth.oauth2_scope.bb_session_update_own_bb_machine',
    'simple_oauth.oauth2_scope.bb_session_use_text_format_bb_rich',
    'simple_oauth.oauth2_scope.bb_session_view_bb_comment',
    'simple_oauth.oauth2_scope.bb_session_view_bb_conductor',
    'simple_oauth.oauth2_scope.bb_session_view_bb_environment',
    'simple_oauth.oauth2_scope.bb_session_view_bb_group',
    'simple_oauth.oauth2_scope.bb_session_view_bb_machine',
    'simple_oauth.oauth2_scope.bb_session_view_bakers_memberships',
    'simple_oauth.oauth2_scope.bb_session_view_bb_project',
    'simple_oauth.oauth2_scope.bb_session_view_bb_run',
    'simple_oauth.oauth2_scope.bb_session_view_bb_team',
    'simple_oauth.oauth2_scope.bb_session_view_bb_term',
    'simple_oauth.oauth2_scope.bb_session_view_bb_ticket',
    'simple_oauth.oauth2_scope.bb_session_view_bb_workspace',
    'simple_oauth.oauth2_scope.bb_session_write_bakers_via_session_scope',
  ];

  /**
   * The config objects the bakers recipe ships a second copy of, by name.
   *
   * A third pair of directories with the same two-install-paths problem:
   * config/sync is what CIM imports on the server, recipes/bakers/config is
   * what a recipe install applies.
   *
   * BB-391 D2 emptied this list of everything auth-related — both machine
   * roles and the `pm` scope are DELETED, not re-pointed — and then D3 put the
   * ONE surviving scope back on it as SCOPE_CONFIG_NAMES, which is the only
   * auth config the pair still carries. The rest of the list is config nothing
   * had ever compared. It stays rather than being deleted along with the roles:
   * the mechanism is about the DIRECTORY PAIR, not about user roles, and a pair
   * with no assertions is how the drift CLAUDE.md forbids gets in.
   *
   * The three entity view displays joined the list on BB-413, and they are
   * the objects on it that drift most cheaply: `EntityDisplayBase::preSave()`
   * → `init()` materialises `content` and `hidden` from the entity's field
   * definitions on the first save, so ANY module that adds a field — a base
   * field of ours, or an extra field from a contrib module the recipe newly
   * enables, which is how `search_api`'s `search_api_excerpt` got in — changes
   * the saved form of all three at once. Both copies then have to be
   * re-exported, and nothing was comparing them.
   *
   * The two PAGE LAYOUTS joined on BB-415, and the reason each is here is a
   * different one. `bb_gate` is new and simply obeys D8: a page layout has
   * exactly two homes and this pair is them. `bb_shell` is the older object and
   * was ABSENT from this list precisely because its second copy sat in
   * `bb_core/config/optional/` — display_builder-owned config shipped from a
   * module that does not depend on display_builder, which CLAUDE.md recorded as
   * a standing BB-396 exception "to fix, not to copy". BB-415 fixed it: the
   * file moved to `recipes/bakers/config/`, its `config: import:` entry went,
   * and the pair became comparable for the first time. Shipping the new layout
   * correctly while the old one kept the wrong placement would have encoded the
   * exception as the pattern.
   *
   * `views.view.projects` joined on BB-421 D9, and it is the same move a
   * third time: giving that display a `display_builder` sources tree put a key
   * into it — `display_extenders.display_builder` — whose schema is
   * `display_builder_views`', a module `bb_core` does not depend on. A view
   * cannot declare that dependency to gate the optional sweep either, because
   * `preSave()` recomputes `dependencies.module` and views never collects
   * display extenders, so a hand-written entry is dropped on the next save.
   * Measured before the move: `SchemaIncompleteException` in twenty-one kernel
   * classes, each merely calling `installConfig(['views'])`. So the file left
   * `bb_core/config/optional` for this pair, and the recipe's
   * `config: import:` entry went with it.
   *
   * `views.view.tickets` joined on BB-315 — the same move a fourth time, for
   * the same display_builder-tree reason. It had survived in
   * `bb_core/config/optional` only by ACCIDENT: it declares `search_api`, so
   * the optional sweep skipped it while that module was absent. BB-315
   * installed search_api, the sweep began reaching it, and the drift it opened
   * against config/sync forced the file to its two homes.
   *
   * `search_api.index.bb_runs` and `views.view.runs` join on BB-454, both
   * shipped directly in `recipes/bakers/config/` from the start rather than
   * moved there later — the same placement `views.view.tickets` and
   * `views.view.projects` ended up at, chosen up front this time because the
   * runs view needs a `search_api` base table exactly as the tickets view
   * does.
   *
   * `core.entity_view_display.bb_team.bb_team.full` joins on BB-484,
   * for the reason `recipes/bakers/recipe.yml`'s R2 comment gives: its
   * `content` and `hidden` maps are materialised from `bb_team`'s field
   * definitions on first save, so the two copies drift the moment the entity
   * gains a field, ours or a contrib module's extra field, exactly as
   * `search_api_excerpt` once drifted the ticket/run/comment trio. This is
   * the guard the display's own comment names, not an extra assertion beside
   * it.
   *
   * `core.entity_view_display.bb_group.bb_group.full` joins on BB-587
   * for the same reason: the group detail's Owner and Workspace body.
   *
   * `core.entity_view_display.bb_conductor.bb_conductor.full` joins on
   * BB-619 for the same reason: the conductor Overview's five zones.
   *
   * `core.entity_view_display.bb_machine.bb_machine.full` joins on
   * BB-619 for the same reason: the machine Overview's five zones.
   *
   * `core.entity_view_display.bb_project.bb_project.epics` joins on
   * BB-628: the inspector Epics list is this project's `epics` view mode.
   *
   * `core.entity_view_display.bb_comment.bb_comment.teaser` joins beside
   * full: the compact comment used on ticket and run summaries. Both comment
   * displays live only in this pair; the module does not ship a third copy.
   *
   * @var array<string>
   */
  private const RECIPE_COPY_CONFIG_NAMES = [
    'core.date_format.normal',
    'core.entity_view_display.bb_comment.bb_comment.full',
    'core.entity_view_display.bb_comment.review.full',
    'bb_core.bb_comment_type.bb_comment',
    'bb_core.bb_comment_type.review',
    'core.entity_view_display.bb_comment.bb_comment.teaser',
    'core.entity_view_display.bb_comment.review.teaser',
    'core.entity_view_display.bb_conductor.bb_conductor.full',
    'core.entity_view_display.bb_group.bb_group.full',
    'core.entity_view_display.bb_machine.bb_machine.full',
    'core.entity_view_display.bb_project.bb_project.full',
    'core.entity_view_display.bb_project.bb_project.epics',
    'core.entity_view_display.bb_run.bb_run.full',
    'core.entity_view_display.bb_run.bb_run.overlay',
    'core.entity_view_display.bb_run.bb_run.teaser',
    'core.entity_view_display.bb_team.bb_team.full',
    'core.entity_view_display.bb_ticket.bb_ticket.full',
    'core.entity_view_display.user.user.full',
    'display_builder.profile.default',
    'island.app.bakers',
    'island.profile.bb_gate',
    'island.profile.bb_onboarding',
    'island.profile.bb_shell',
    'island.settings',
    'bb_core.bb_vocabulary.label',
    'bb_core.bb_vocabulary.recipe',
    'bb_core.bb_vocabulary.type',
    'search_api.index.bb_runs',
    // The three admin listings under /admin/bakers (BB-471). They used to
    // reach the recipe path through bb_dashboard's own `config: import:`
    // block; with that module gone they need the two homes every other
    // shipped view has. No `config: import:` entry — a file in the recipe's
    // own config/ is on the same strict list, so naming it would be a second
    // route to one file.
    'views.view.conductors',
    'views.view.conductor_tickets',
    'views.view.bb_conductors',
    'views.view.bb_runs',
    'views.view.bb_tickets',
    'views.view.groups',
    'views.view.machines',
    'views.view.project_board',
    'views.view.projects',
    'views.view.runs',
    'views.view.tickets',
    'views.view.worklog',
    // Both simple config, reachable on the recipe path for exactly that
    // reason (BB-476 D8); credentials ship empty in both copies.
    'social_auth.settings',
    'social_auth_google.settings',
    // The three consolidated user-profile fields (BB-507 D3/D4): the core
    // image field that doubles as social_auth's avatar target, and two plain
    // string fields. Config entities, so the recipe path skips them like any
    // other field on this list.
    'field.storage.user.user_picture',
    'field.field.user.user.user_picture',
    'field.storage.user.field_full_name',
    'field.field.user.user.field_full_name',
    'field.storage.user.field_developer_title',
    'field.field.user.user.field_developer_title',
    // The consolidated profile's displays and the avatar image style they
    // render through (BB-507 task 6).
    'image.style.avatar',
    // The square crop the avatar style applies.
    'crop.type.bb_avatar',
    'core.entity_view_display.user.user.compact',
    'core.entity_form_display.user.user.default',
    // The project, group and workspace forms crop their image too, and that
    // widget is bb_image's, which bb_core does not depend on.
    'core.entity_form_display.bb_project.bb_project.settings',
    'core.entity_form_display.bb_group.bb_group.create',
    'core.entity_form_display.bb_group.bb_group.settings',
    'core.entity_form_display.bb_workspace.bb_workspace.settings',
    // The onboarding welcome flow's profile fields (BB-432 task 1). The
    // wizard declares its Form API fields in PHP; later edits use
    // `user.user.default`.
    'field.storage.user.field_bb_background',
    'field.field.user.user.field_bb_background',
    'field.storage.user.field_onboarding_completed',
    'field.field.user.user.field_onboarding_completed',
    ...self::SCOPE_CONFIG_NAMES,
    // Composite statistics config entities need both homes because recipes
    // skip config entities installed by a module.
    'bb_core.bb_measurement.closed_tickets',
    'bb_core.bb_measurement.created_tickets',
    'bb_core.bb_measurement.open_tickets',
    'bb_core.bb_measurement.runs',
    'bb_core.bb_measurement.tickets_per_run',
    // The ratio measurement, used only by the *_overview matrices, which are
    // the three shipped `matrix` figures and always carry the rolling
    // `windows` categories rather than calendar buckets.
    'bb_core.bb_measurement.runs_per_ticket',
    'bb_core.bb_figure.project_overview',
    'bb_core.bb_figure.user_overview',
    'bb_core.bb_figure.user_projects',
    'bb_core.bb_figure.team_projects',
    'bb_core.bb_figure.team_members',
    'bb_core.bb_figure.team_user_overview',
    'bb_core.bb_figure.team_user_projects',
    // Three single-measurement grouped_horizontal_bars trend figures per
    // scope, each its own navigable sub-tab, with bar length scaled against
    // one shared maximum across the visible period rather than a per-row
    // 100%, so a quiet period is distinguishable from a busy one.
    'bb_core.bb_figure.team_user_tickets_trend',
    'bb_core.bb_figure.team_user_runs_trend',
    'bb_core.bb_figure.team_user_tokens_trend',
    'bb_core.bb_figure.team_tickets_trend',
    'bb_core.bb_figure.team_runs_trend',
    'bb_core.bb_figure.team_tokens_trend',
    'bb_core.bb_figure_group.overview',
    'bb_core.bb_figure_group.tickets',
    'bb_core.bb_figure_group.runs',
    'bb_core.bb_figure_group.breakdown',
    // The token measures: a sum over bb_run.tokens, plus one per run
    // state for the state x model matrix.
    'bb_core.bb_measurement.run_tokens',
    'bb_core.bb_measurement.run_tokens_claimed',
    'bb_core.bb_measurement.run_tokens_running',
    'bb_core.bb_measurement.run_tokens_done',
    'bb_core.bb_measurement.run_tokens_expired',
    'bb_core.bb_measurement.run_tokens_failed',
    // The token figures across every scope: a by-model breakdown plus the
    // trend/matrix pair above. The per-state x model matrix
    // (`*_tokens_by_state_model`) and its figure group were retired
    // entirely — the by-model breakdown below is the sole surviving model
    // crosstab.
    'bb_core.bb_figure.team_models',
    'bb_core.bb_figure_group.tokens',
    // The time-series axis: one series per dimension value inside each
    // day/month bucket, on the mechanism the comparison chart provides.
    // `team_members_tickets_trend` proves the axis is generic over any
    // measurement dimension, not special-cased for model.
    'bb_core.bb_figure.team_models_trend',
    'bb_core.bb_figure.team_members_tickets_trend',
    // Project › Stats: the Insights building blocks for one project.
    'bb_core.bb_figure.project_flow',
    'bb_core.bb_figure.project_people',
  ];

  /**
   * The create-dialog config bb_core ships from config/install (D10).
   *
   * The FOURTH pair of directories, and it is the module-install pair rather
   * than the recipe one: a form mode and a form display are `bb_core.`-owned
   * enough to live in the module, so spec D10 ships both from
   * `bb_core/config/install` and names them under the recipe's
   * `config: import:`, with `config/sync/**` holding the CIM copy.
   *
   * They join this list on BB-421, and the reason is a failure rather than
   * tidiness. Both displays briefly carried
   * `dependencies.enforced.config` on the term bundles to
   * force a recipe install order, and the vocabulary is not shippable from this
   * module — so `ConfigInstaller::checkConfigurationToInstall()` refused, and
   * the functional suite reported 96 `UnmetDependenciesException` errors. The
   * edge is gone from both copies of both files, and nothing was comparing
   * those copies: a re-added edge in ONE of them would have been invisible
   * here, and an entity display is the object on this list that drifts most
   * cheaply, because `EntityDisplayBase::preSave()` → `init()` materialises
   * `content` and `hidden` from the entity's field definitions on every first
   * save.
   *
   * The form MODES are listed beside their displays even though nothing has
   * ever gone wrong with one: a display's `dependencies.config` names its mode,
   * so a mode present on one path and absent or renamed on the other takes the
   * display down with it, and the pair is the unit worth asserting.
   *
   * @var array<string>
   */
  private const MODULE_COPY_CONFIG_NAMES = [
    'core.entity_form_mode.bb_group.create',
    'core.entity_form_mode.bb_group.settings',
    'core.entity_form_mode.bb_team.settings',
    'core.entity_form_display.bb_team.bb_team.settings',
    'core.entity_form_mode.bb_project.settings',
    'core.entity_form_mode.bb_ticket.create',
    'core.entity_form_display.bb_ticket.bb_ticket.create',
    'core.entity_form_mode.bb_workspace.settings',
  ];

  /**
   * Config names that must exist in NEITHER directory of the pair (AC1).
   *
   * BB-391 retired every machine ROLE and the four
   * `system.action.user_*_role_action.*` configs that declare the roles as a
   * config dependency and would abort CIM if they outlived them.
   *
   * Asserted as absence rather than simply dropped from the list above, because
   * "the list no longer mentions it" is not a check — a re-added file would
   * sail straight through a list that stopped naming it.
   *
   * @var array<string>
   */
  private const DELETED_CONFIG_NAMES = [
    'user.role.bb_agent',
    'user.role.bb_session',
    'system.action.user_add_role_action.bb_agent',
    'system.action.user_add_role_action.bb_session',
    'system.action.user_remove_role_action.bb_agent',
    'system.action.user_remove_role_action.bb_session',
  ];

  /**
   * Neither install path still ships a deleted role or scope.
   */
  public function testDeletedConfigIsAbsentFromBothCopies(): void {
    $root = $this->repositoryRoot();

    foreach (self::DELETED_CONFIG_NAMES as $name) {
      self::assertFileDoesNotExist(
        $root . '/recipes/bakers/config/' . $name . '.yml',
        "$name must be gone from the recipe install path.",
      );
      self::assertFileDoesNotExist(
        $root . '/config/sync/' . $name . '.yml',
        "$name must be gone from config/sync.",
      );
    }
  }

  /**
   * Both copies of every recipe-duplicated config parse to the same structure.
   *
   * Named for what it asserts. It was `testUserRoleCopiesAreIdentical()` until
   * BB-391 deleted every user role from the list it iterates, at which point
   * the name described nothing the body did — and a name that lies about its
   * subject is how an assertion ends up dropped by someone tidying up.
   */
  public function testRecipeCopiesAreStructurallyIdentical(): void {
    $root = $this->repositoryRoot();

    foreach (self::RECIPE_COPY_CONFIG_NAMES as $name) {
      $recipe_file = $root . '/recipes/bakers/config/' . $name . '.yml';
      $sync_file = $root . '/config/sync/' . $name . '.yml';
      self::assertFileExists($recipe_file);
      self::assertFileExists($sync_file);

      $recipe_data = Yaml::parseFile($recipe_file);
      $sync_data = Yaml::parseFile($sync_file);
      self::assertIsArray($recipe_data);
      self::assertIsArray($sync_data);
      // Same normalisation as below: an export carries uuid and _core, a
      // recipe copy carries neither, and those two keys are the only
      // permitted difference.
      self::assertArrayNotHasKey('uuid', $recipe_data, "$name ships no uuid in the recipe.");
      self::assertArrayNotHasKey('_core', $recipe_data, "$name ships no _core in the recipe.");
      unset($sync_data['uuid'], $sync_data['_core']);

      SortArray::sortByKeyRecursive($recipe_data);
      SortArray::sortByKeyRecursive($sync_data);
      self::assertSame($sync_data, $recipe_data, "The two copies of $name agree.");
    }
  }

  /**
   * Comment full and teaser displays have no module install or optional copy.
   */
  public function testCommentDisplaysHaveNoModuleCopy(): void {
    $root = $this->repositoryRoot();
    $module = $root . '/web/modules/custom/bb_core/config';
    foreach ([
      'core.entity_view_display.bb_comment.bb_comment.full',
      'core.entity_view_display.bb_comment.bb_comment.teaser',
    ] as $name) {
      self::assertFileDoesNotExist(
        $module . '/install/' . $name . '.yml',
        "$name must not ship as module install config.",
      );
      self::assertFileDoesNotExist(
        $module . '/optional/' . $name . '.yml',
        "$name must not ship as module optional config.",
      );
    }
  }

  /**
   * My projects carries the complete ordered measurement set.
   */
  public function testUserProjectBreakdownOrdersItsMeasurements(): void {
    $root = $this->repositoryRoot();
    $figure = Yaml::parseFile($root . '/config/sync/bb_core.bb_figure.user_projects.yml');
    self::assertIsArray($figure);
    self::assertSame(
      ['closed_tickets', 'runs', 'job_rating', 'rated_tickets', 'run_tokens'],
      $figure['measurements'],
    );
  }

  /**
   * Both copies of every module-shipped config parse to the same structure.
   *
   * Named for the DIRECTORY PAIR rather than for the objects, because that is
   * what it asserts and the object list has grown twice — the OG roles of
   * BB-316/317, and the create-dialog modes and displays of BB-421. A name
   * that describes only the first arrival is how the second gets dropped by
   * someone tidying up, which is the mistake
   * `testRecipeCopiesAreStructurallyIdentical()` was renamed to fix.
   */
  public function testModuleInstallCopiesAreStructurallyIdentical(): void {
    $root = $this->repositoryRoot();
    $module = $root . '/web/modules/custom/bb_core/config/install';
    $sync = $root . '/config/sync';

    foreach ([...self::ROLE_CONFIG_NAMES, ...self::MODULE_COPY_CONFIG_NAMES] as $name) {
      $module_file = $module . '/' . $name . '.yml';
      $sync_file = $sync . '/' . $name . '.yml';
      self::assertFileExists($module_file);
      self::assertFileExists($sync_file);

      $module_data = Yaml::parseFile($module_file);
      $sync_data = Yaml::parseFile($sync_file);
      self::assertIsArray($module_data);
      self::assertIsArray($sync_data);
      // D4 — an export carries uuid and _core; the config/install copy carries
      // neither, so those two keys are the only permitted difference.
      self::assertArrayHasKey('uuid', $sync_data, "$name carries an exported uuid.");
      self::assertArrayNotHasKey('uuid', $module_data, "$name ships no uuid in config/install.");
      self::assertArrayNotHasKey('_core', $module_data, "$name ships no _core in config/install.");
      unset($sync_data['uuid'], $sync_data['_core']);

      SortArray::sortByKeyRecursive($module_data);
      SortArray::sortByKeyRecursive($sync_data);
      self::assertSame($sync_data, $module_data, "The two copies of $name agree.");
    }
  }

  /**
   * Both shipped gate profiles frame the whole entry surface and nothing else.
   *
   * THE LIST GREW WITH BB-430 and the test's point did not: it compares the
   * TWO COPIES against one literal, so a one-sided edit of the gate paths still
   * fails here. That is why the paths are restated rather than read from one of
   * the files — reading either copy would make the assertion agree with itself.
   *
   * Six paths joined the original two, each a screen somebody meets before the
   * application shell: the entry form is mounted on both `user.login` and
   * `user.register`, `/user/check-mail` is the confirmation, `/user/reset/*`
   * is the one-time link's own two hops, and `/home/new-workspace` and
   * `/home/join/*` are where a tenancy is created or joined. `/user/password`
   * is deliberately absent — `user.pass` is still core's own form.
   *
   * BB-496 adds two more: `/oauth/device` is the RFC 8628 device-code
   * verification screen and `/oauth/authorize` is simple_oauth's own consent
   * screen, both mounted before a session exists in the same way `/user/login`
   * is — a CLI sign-in reaches them with no application shell to render into.
   *
   * The onboarding wizard `/home/onboarding` is not on this list: it has its
   * own island profile, `bb_onboarding`.
   */
  public function testGateEntryPathsAgreeWithLoginScope(): void {
    $expected = [
      '/home',
      '/home/new-workspace',
      '/home/join',
      '/home/join/*',
      '/user/login',
      '/user/logout',
      '/user/logout/confirm',
      '/user/register',
      '/user/check-mail',
      '/user/reset/*',
      '/oauth/authorize',
      '/oauth/device',
    ];
    foreach (['recipes/bakers/config', 'config/sync'] as $directory) {
      $data = Yaml::parseFile($this->repositoryRoot() . '/' . $directory . '/island.profile.bb_gate.yml');
      self::assertSame(implode("\n", $expected), $data['conditions']['request_path']['pages'], "$directory states the entry surface.");
      self::assertFalse($data['conditions']['request_path']['negate']);
      self::assertSame('bb_theme:gate', $data['layout']);
    }
  }

  /**
   * Both copies of the tickets index parse to the same structure.
   *
   * The THIRD directory pair, and the only one of the four config objects
   * BB-490 edits that nothing was comparing. `search_api.index.bb_tickets`
   * reaches the recipe path through `recipes/bakers/recipe.yml`'s
   * `config: import:` rather than from a file in the recipe's own `config/`,
   * so its recipe-path copy sits in `bb_core/config/optional/` and neither
   * `testRecipeCopiesAreStructurallyIdentical()` nor
   * `testModuleInstallCopiesAreStructurallyIdentical()` looks there.
   */
  public function testOptionalConfigCopiesAreStructurallyIdentical(): void {
    $root = $this->repositoryRoot();

    foreach (['search_api.index.bb_tickets'] as $name) {
      $optional_file = $root . '/web/modules/custom/bb_core/config/optional/' . $name . '.yml';
      $sync_file = $root . '/config/sync/' . $name . '.yml';
      self::assertFileExists($optional_file);
      self::assertFileExists($sync_file);

      $optional_data = Yaml::parseFile($optional_file);
      $sync_data = Yaml::parseFile($sync_file);
      self::assertIsArray($optional_data);
      self::assertIsArray($sync_data);
      self::assertArrayNotHasKey('uuid', $optional_data, "$name ships no uuid in config/optional.");
      self::assertArrayNotHasKey('_core', $optional_data, "$name ships no _core in config/optional.");
      unset($sync_data['uuid'], $sync_data['_core']);

      SortArray::sortByKeyRecursive($optional_data);
      SortArray::sortByKeyRecursive($sync_data);
      self::assertSame($sync_data, $optional_data, "The two copies of $name agree.");

      self::assertArrayHasKey(
        'closed',
        $optional_data['field_settings'] ?? [],
        "$name indexes the closed flag.",
      );
    }
  }

  /**
   * The runs index carries the closed flag the listings filter on (BB-490).
   */
  public function testRunsIndexCarriesClosedField(): void {
    $root = $this->repositoryRoot();
    $data = Yaml::parseFile($root . '/recipes/bakers/config/search_api.index.bb_runs.yml');
    self::assertIsArray($data);
    self::assertArrayHasKey('closed', $data['field_settings'] ?? []);
  }

  /**
   * Both listings filter closed rows on every one of their displays.
   *
   * ASSERTED ON EVERY DISPLAY THAT OVERRIDES `filters`, NOT ONLY `default`.
   * The docblock this replaced argued the default-only check made the
   * criterion "every ticket listing and every run listing" true "by
   * construction"; that argument is false for `views.view.tickets` —
   * `my_work`, `project_tickets` and `team_tickets` each
   * override `filters`
   * and inherit nothing from `default`. This branch's own history proved it
   * twice: the closed filter went missing from `project_tickets` and
   * `team_tickets` after the exposed-filter rearchitecture, and this loop is
   * what would have caught it before CI did. `page_1` (the full table) and
   * `views.view.runs`'s `project_runs`/`team_runs` genuinely do inherit —
   * none of the three declares a `filters` override — so they are covered by
   * the `default` assertion alone rather than asserted individually, which
   * would otherwise read a KeyError as "missing" instead of "inherited".
   *
   * Also pins AC8: `remember: false`, so a future edit cannot turn the
   * position into a stored account preference without this test noticing.
   */
  public function testBothListingsCarryTheClosedFilter(): void {
    $root = $this->repositoryRoot();

    $displays = [
      'views.view.tickets' => ['default', 'my_work', 'project_tickets', 'team_tickets'],
      'views.view.runs' => ['default'],
    ];

    foreach ($displays as $name => $display_ids) {
      foreach (['/recipes/bakers/config/', '/config/sync/'] as $dir) {
        $data = Yaml::parseFile($root . $dir . $name . '.yml');
        self::assertIsArray($data);
        foreach ($display_ids as $display_id) {
          $filters = $data['display'][$display_id]['display_options']['filters'] ?? [];
          self::assertArrayHasKey(
            'bb_closed_rows',
            $filters,
            "$name$dir display '$display_id' filters closed rows.",
          );
          self::assertSame('bb_closed_rows', $filters['bb_closed_rows']['plugin_id']);
          self::assertTrue($filters['bb_closed_rows']['exposed']);
          self::assertFalse(
            $filters['bb_closed_rows']['expose']['remember'],
            "$name$dir display '$display_id' must not remember the position (AC8).",
          );
        }
      }
    }
  }

  /**
   * The displays that inherit the closed filter carry no override (BB-490).
   *
   * `testBothListingsCarryTheClosedFilter()` asserts the docblock's claim
   * that `page_1`, `project_runs` and `team_runs` "genuinely do inherit", but
   * until now nothing checked it — the previous review verdict's finding 4
   * asked for exactly this: a display inherits the `default` display's
   * filter only if it declares no `filters` override at all. Without this,
   * a future edit giving one of these three its own `filters` block would
   * recreate the decorative-control defect this branch already repaired
   * twice on `project_tickets` and `team_tickets`, with the suite still
   * green.
   */
  public function testDisplaysWithNoOwnFilterBlockInheritTheClosedFilter(): void {
    $root = $this->repositoryRoot();

    $inheriting = [
      'views.view.tickets' => ['page_1'],
      'views.view.runs' => ['project_runs', 'team_runs'],
    ];

    foreach ($inheriting as $name => $display_ids) {
      foreach (['/recipes/bakers/config/', '/config/sync/'] as $dir) {
        $data = Yaml::parseFile($root . $dir . $name . '.yml');
        self::assertIsArray($data);
        foreach ($display_ids as $display_id) {
          self::assertArrayNotHasKey(
            'filters',
            $data['display'][$display_id]['display_options'] ?? [],
            "$name$dir display '$display_id' must inherit the closed filter from 'default' rather than override 'filters'.",
          );
        }
      }
    }
  }

  /**
   * My work has one hiding predicate and it is the closed one (BB-490 D5).
   *
   * Two predicates meant two vocabularies for one question, and the Closed
   * position of the control would have returned an empty list on exactly the
   * landing page.
   */
  public function testMyWorkNoLongerFiltersOnTerminalState(): void {
    $root = $this->repositoryRoot();

    foreach (['/recipes/bakers/config/', '/config/sync/'] as $dir) {
      $data = Yaml::parseFile($root . $dir . 'views.view.tickets.yml');
      self::assertIsArray($data);
      $filters = $data['display']['my_work']['display_options']['filters'] ?? [];
      self::assertArrayNotHasKey('bb_ticket_is_open', $filters);
    }
  }

  /**
   * Resolves the repository root from this file's own location.
   *
   * The walk is tests/src/Unit -> src -> tests -> bb_core -> custom ->
   * modules -> web -> the repository root: seven levels, not the six the plan
   * estimated.
   */
  private function repositoryRoot(): string {
    return dirname(__DIR__, 7);
  }

}
