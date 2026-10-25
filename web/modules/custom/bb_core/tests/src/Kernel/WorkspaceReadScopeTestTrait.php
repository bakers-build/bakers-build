<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\user\UserInterface;

/**
 * Builds the two-workspace world the workspace read scope is asserted against.
 *
 * Every BB-318 kernel test needs the same shape: two workspaces that share
 * nothing, each carrying one row of every in-scope entity type plus an account
 * whose only membership is in that workspace. Cross-workspace isolation is only
 * observable when both sides exist, so the fixture is built rather than seeded
 * — a recipe world holds exactly one workspace on purpose (spec D10).
 *
 * The world's owner is a dedicated throwaway account, because
 * `og.settings.auto_add_group_owner_membership` makes every owner a member on
 * save (spec Fact 15). An actor that owned a group would therefore hold a
 * membership nobody wrote, and the negative half of every assertion would be
 * testing the fixture instead of the filter.
 */
trait WorkspaceReadScopeTestTrait {

  use OgScopeFixtureTrait;

  /**
   * The entity schemas every read-scope test needs installed.
   *
   * @var array<string>
   */
  private const READ_SCOPE_ENTITY_TYPES = [
    'user', 'og_membership',
    'bb_workspace', 'bb_group', 'bb_team', 'bb_machine', 'bb_project',
    'bb_ticket', 'bb_run', 'bb_comment', 'bb_environment',
    'bb_conductor', 'bb_term', 'bb_ticket_template',
  ];

  /**
   * The entity types the read scope narrows, with their anchor field.
   *
   * A method rather than a constant: eight classes use this trait and only two
   * read the set, and phpstan reports an unused class constant per USING class.
   *
   * The anchor is only used for diagnostics — the rule itself lives in
   * WorkspaceReadScopeSubscriber, and a test that restated it would pass
   * against its own copy.
   *
   * @return array<string, string>
   *   The anchor condition field, keyed by entity type id.
   */
  protected static function inScopeEntityTypes(): array {
    return [
      'bb_workspace' => 'id',
      'bb_group' => 'workspace_id',
      'bb_team' => 'workspace_id',
      'bb_term' => 'workspace_id',
      'bb_project' => 'id',
      'bb_ticket' => 'project_id',
      'bb_ticket_template' => 'project_id',
      'bb_environment' => 'project_id',
      'bb_conductor' => 'project_id',
      'bb_run' => 'ticket_id.entity.project_id',
      'bb_comment' => 'ticket_id.entity.project_id',
      'user' => 'uid',
      // BB-391: a membership anchors on the PAIR (entity_type, entity_id), so
      // the "anchor" named here is only half of it — the other half is the
      // group entity type each term discriminates on. Diagnostics only, as
      // above.
      'og_membership' => 'entity_id',
    ];
  }

  /**
   * A lease expiry far enough away that no suite run can outlive it.
   *
   * Bounded by the signed 32-bit range: the `timestamp` field type stores an
   * `int` column, so a year-2100 value is rejected outright by MySQL with
   * "Out of range value for column 'claim_expires_at'".
   */
  private const FAR_FUTURE_TIMESTAMP = 2147483000;

  /**
   * The built world, keyed by side ('a', 'b') then by entity type id.
   *
   * @var array<string, array<string, \Drupal\Core\Entity\EntityInterface>>
   */
  private array $world = [];

  /**
   * The account that owns every group in the world.
   *
   * OG makes an owner a member on save, so this account is a member of all of
   * them and can therefore never be an actor under test.
   */
  private UserInterface $worldOwner;

  /**
   * Installs the schemas, config and OG registration the fixture needs.
   */
  protected function installReadScopeEnvironment(): void {
    foreach (self::READ_SCOPE_ENTITY_TYPES as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installConfig(['user']);
    // The term bundles are owned by the recipe, which a kernel test does
    // not apply, so the fixture creates them itself.
    foreach (['type', 'recipe', 'label'] as $vid) {
      BbVocabulary::create(['id' => $vid, 'label' => $vid])->save();
    }
    // A bundle created after the container booted leaves the typed-data
    // derivative `entity:bb_term:label` undiscovered, and ->validate()
    // is the caller that needs it — without this a user of this trait errors on
    // PluginNotFoundException instead of asserting anything, exactly as the
    // three BbTerm* suites record. installOgScopeFixture() below happens to
    // clear both caches for og_membership's own bundle, so today the clears
    // arrive by luck of ordering; stating them where the bundle is created is
    // what keeps them arriving if that call ever moves or goes away.
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    $this->installOgScopeFixture();
    // Uid 1 bypasses every access check, so it must not be an actor.
    $this->createAccount('uid1-dummy');
    $this->worldOwner = $this->createAccount('world-owner');
  }

  /**
   * Builds two disjoint workspaces, each holding one row of every type.
   *
   * Neither side's member is given a membership here: a test states the
   * memberships it is about, so the same world serves isolation, project
   * scoping and the admin rule without one test's fixture explaining another
   * test's result.
   */
  protected function buildTwoWorkspaceWorld(): void {
    foreach (['a', 'b'] as $side) {
      $this->world[$side] = $this->buildWorkspaceSide($side);
    }
  }

  /**
   * Builds one workspace and one row of every in-scope type below it.
   *
   * @param string $side
   *   A short label distinguishing the side, used in every machine name.
   *
   * @return array<string, \Drupal\Core\Entity\EntityInterface>
   *   The created entities, keyed by entity type id, plus 'member'.
   */
  private function buildWorkspaceSide(string $side): array {
    $owner_id = $this->worldOwner->id();
    $workspace = $this->createEntity('bb_workspace', [
      'name' => "workspace-$side",
      'owner_user_id' => $owner_id,
    ]);
    $group = $this->createEntity('bb_group', [
      'name' => "group-$side",
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $owner_id,
    ]);
    $team = $this->createEntity('bb_team', [
      'name' => "team-$side",
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $owner_id,
    ]);
    // The project names this side's team: since BB-419 a project belongs to
    // at least one team, so a teamless fixture would be a world no valid write
    // could have produced. `save()` does not validate, so it would go in
    // unnoticed and every test using this world would be asserting against a
    // shape the product refuses.
    $project = $this->createEntity('bb_project', [
      'name' => "project-$side",
      'group_id' => $group->id(),
      'teams' => [$team->id()],
      'owner_user_id' => $owner_id,
    ]);
    $ticket = $this->createEntity('bb_ticket', [
      'identifier' => 'T-' . strtoupper($side),
      'title' => "ticket-$side",
      'workflow' => 'bb_work',
      'project_id' => $project->id(),
      'owner_user_id' => $owner_id,
    ]);
    $template = $this->createEntity('bb_ticket_template', [
      'name' => "template-$side",
      'enabled' => TRUE,
      'title_pattern' => "template-$side",
      'description' => ['value' => 'Body', 'format' => 'plain_text'],
      'workflow' => 'bb_work',
      'target_state' => 'qualification',
      'project_id' => $project->id(),
      'owner_user_id' => $owner_id,
    ]);
    $environment = $this->createEntity('bb_environment', [
      'name' => "env-$side",
      'project_id' => $project->id(),
      'owner_user_id' => $owner_id,
    ]);
    $machine = $this->createEntity('bb_machine', [
      'name' => "machine-$side",
      'host_key' => "host-$side",
      'owner_user_id' => $owner_id,
    ]);
    // One label per side, so cross-workspace term isolation and the ticket's
    // own label rule are both observable in this world (BB-339 D7, D6).
    $term = $this->createEntity('bb_term', [
      'vid' => 'label',
      'name' => "label-$side",
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $owner_id,
    ]);
    $conductor = $this->createEntity('bb_conductor', [
      'conductor_id' => "node-$side",
      'label' => "node-$side",
      'project_id' => $project->id(),
      'machine' => $machine->id(),
      'owner_user_id' => $owner_id,
    ]);
    $run = $this->createEntity('bb_run', [
      'conductor_id' => $conductor->id(),
      'ticket_id' => $ticket->id(),
      'owner_user_id' => $owner_id,
      'state' => 'claimed',
      // Far future, not "now + something": bb_dashboard's active_tickets
      // query alter drops a ticket whose run is claimed with a lapsed lease, so
      // a relative lease would turn this fixture into a time bomb.
      'claim_expires_at' => self::FAR_FUTURE_TIMESTAMP,
    ]);
    $comment = $this->createEntity('bb_comment', [
      'ticket_id' => $ticket->id(),
      'author' => $owner_id,
      'body' => ['value' => "comment-$side"],
      'type' => 'spec',
    ]);

    return [
      'bb_workspace' => $workspace,
      // The world owner's own workspace membership: the og_membership row this
      // side is identified by (BB-391). FETCHED rather than written —
      // `og.settings.auto_add_group_owner_membership` created it when the
      // workspace was saved, and a second create() aborts with "An OG
      // membership already exists".
      'og_membership' => $this->addMembership($workspace, $this->worldOwner),
      'bb_group' => $group,
      'bb_machine' => $machine,
      'bb_team' => $team,
      'bb_project' => $project,
      'bb_ticket' => $ticket,
      'bb_ticket_template' => $template,
      'bb_environment' => $environment,
      'bb_conductor' => $conductor,
      'bb_run' => $run,
      'bb_comment' => $comment,
      'bb_term' => $term,
      'member' => $this->createAccount("member-$side"),
    ];
  }

  /**
   * Returns the entity of the given type on the given side of the world.
   *
   * @param string $side
   *   Either 'a' or 'b'.
   * @param string $key
   *   An entity type id, or 'member'.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The fixture entity.
   */
  protected function fixture(string $side, string $key): ContentEntityInterface {
    self::assertArrayHasKey($side, $this->world, "World side $side exists.");
    self::assertArrayHasKey($key, $this->world[$side], "Fixture $key exists.");
    $entity = $this->world[$side][$key];
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    return $entity;
  }

  /**
   * Returns the member account of the given side.
   *
   * @param string $side
   *   Either 'a' or 'b'.
   *
   * @return \Drupal\user\UserInterface
   *   The account.
   */
  protected function member(string $side): UserInterface {
    $account = $this->world[$side]['member'] ?? NULL;
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * Creates and saves an entity of the given type.
   *
   * @param string $entity_type_id
   *   The entity type id.
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved entity.
   */
  protected function createEntity(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Creates an account holding exactly the given permissions.
   *
   * @param string $name
   *   The user name; a dedicated role id is derived from it.
   * @param array<string> $permissions
   *   The permissions granted on that role.
   *
   * @return \Drupal\user\UserInterface
   *   The saved account.
   */
  protected function createAccount(string $name, array $permissions = []): UserInterface {
    $role_id = 'r_' . preg_replace('/[^a-z0-9_]/', '_', strtolower($name));
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    if ($permissions !== []) {
      user_role_grant_permissions($role_id, $permissions);
    }
    $account = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    self::assertInstanceOf(UserInterface::class, $account);
    $account->save();
    return $account;
  }

  /**
   * Runs an access-checked collection query as the given account.
   *
   * @param string $entity_type_id
   *   The entity type to query.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to run as.
   *
   * @return array<int>
   *   The returned entity ids, as integers.
   */
  protected function queryIdsAs(string $entity_type_id, AccountInterface $account): array {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account);
    try {
      $ids = $this->container->get('entity_type.manager')
        ->getStorage($entity_type_id)
        ->getQuery()
        ->accessCheck(TRUE)
        ->execute();
    }
    finally {
      $switcher->switchBack();
    }
    return array_map('intval', array_values($ids));
  }

}
