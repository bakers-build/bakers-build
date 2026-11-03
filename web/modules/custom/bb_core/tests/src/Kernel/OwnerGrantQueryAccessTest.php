<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\entity\QueryAccess\QueryAccessHandlerInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Query access on owner-granted entities agrees with checkAccess().
 *
 * The bb_conductor and bb_run types grant view to the account that owns
 * the row on top of the `view <type>` permission. This asserts the SQL gate
 * reaches the same verdict as the per-entity handler for every account/row
 * pair, which is AC 6's evidence (spec V1).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class OwnerGrantQueryAccessTest extends KernelTestBase {

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
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_team', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    // uid1 is a superuser; keep it out of the way.
    $this->createUserWithPermissions('uid1-dummy', []);
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
  private function createUserWithPermissions(string $name, array $permissions): UserInterface {
    $role_id = 'r_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    if ($permissions !== []) {
      user_role_grant_permissions($role_id, $permissions);
    }
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Runs an access-checked entity query as the given account.
   *
   * @param string $entity_type_id
   *   The entity type to query.
   * @param \Drupal\user\UserInterface $account
   *   The account to run as.
   *
   * @return array<int>
   *   The entity ids the query returns, as integers.
   */
  private function queryAs(string $entity_type_id, UserInterface $account): array {
    $this->container->get('account_switcher')->switchTo($account);
    $ids = $this->container->get('entity_type.manager')->getStorage($entity_type_id)
      ->getQuery()->accessCheck(TRUE)->execute();
    $this->container->get('account_switcher')->switchBack();
    return array_map('intval', array_values($ids));
  }

  /**
   * The conductor owner sees own rows; a stranger sees none.
   */
  public function testConductorQueryAccessMirrorsOwnerGrant(): void {
    $owner = $this->createUserWithPermissions('owner', ['register bakers conductor']);
    $stranger = $this->createUserWithPermissions('stranger', ['register bakers conductor']);

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_conductor');
    $mine = $storage->create([
      'label' => 'mine',
      'owner_user_id' => $owner->id(),
    ]);
    $mine->save();
    $theirs = $storage->create([
      'label' => 'theirs',
      'owner_user_id' => $stranger->id(),
    ]);
    $theirs->save();

    $this->assertSame([(int) $mine->id()], $this->queryAs('bb_conductor', $owner));
    $this->assertSame([(int) $theirs->id()], $this->queryAs('bb_conductor', $stranger));

    // And the query agrees with the per-entity handler, row by row.
    $matrix = [
      [$owner, $mine, TRUE],
      [$owner, $theirs, FALSE],
      [$stranger, $mine, FALSE],
    ];
    foreach ($matrix as [$account, $entity, $expected]) {
      $this->assertSame(
        $expected,
        $entity->access('view', $account),
        sprintf('checkAccess disagrees for %s on %s', $account->getAccountName(), $entity->label()),
      );
    }
  }

  /**
   * A plain `view bb_conductor` holder keeps seeing every row in its scope.
   *
   * "Every row" became "every row in its scope" with BB-318: the workspace
   * read scope narrows the permission-derived group, so the reader now needs a
   * membership covering the rows' project. What this case still asserts is the
   * thing it was written for — that the OWNER grant does not narrow a
   * permission holder down to its own rows — and that is only observable when
   * the rows it sees are somebody else's.
   */
  public function testViewPermissionIsNotNarrowedByTheOwnerGrant(): void {
    $reader = $this->createUserWithPermissions('reader', ['view bb_conductor']);
    $other = $this->createUserWithPermissions('other', ['register bakers conductor']);
    $project = $this->createProjectMemberOf($reader);

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_conductor');
    foreach (['a', 'b'] as $name) {
      $storage->create([
        'label' => $name,
        'owner_user_id' => $other->id(),
        'project_id' => $project->id(),
      ])->save();
    }

    $this->assertCount(2, $this->queryAs('bb_conductor', $reader));
  }

  /**
   * Creates a project the given account is an active member of.
   *
   * @param \Drupal\user\UserInterface $account
   *   The account to make a member.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved project.
   */
  private function createProjectMemberOf(UserInterface $account): ContentEntityInterface {
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')->create(['name' => 'scope-team-' . $account->id()]);
    $this->assertInstanceOf(ContentEntityInterface::class, $team);
    $team->save();
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')->create([
        'name' => 'scope-project-' . $account->id(),
        'teams' => [$team->id()],
      ]);
    $this->assertInstanceOf(ContentEntityInterface::class, $project);
    $project->save();
    $this->addMembership($team, $account, []);
    return $project;
  }

  /**
   * An account with neither permission sees nothing, and the query says so.
   */
  public function testNoPermissionYieldsNoRows(): void {
    $nobody = $this->createUserWithPermissions('nobody', []);
    $other = $this->createUserWithPermissions('other2', ['register bakers conductor']);

    $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'label' => 'c',
      'owner_user_id' => $other->id(),
    ])->save();

    $this->assertSame([], $this->queryAs('bb_conductor', $nobody));
  }

  /**
   * Creates one conductor owned by the account plus one run on it.
   *
   * @param \Drupal\user\UserInterface $account
   *   The owning account.
   * @param string $name
   *   The conductor's machine id and label.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved run.
   */
  private function createRunOwnedBy(UserInterface $account, string $name): ContentEntityInterface {
    $entity_type_manager = $this->container->get('entity_type.manager');
    $conductor = $entity_type_manager->getStorage('bb_conductor')->create([
      'label' => $name,
      'owner_user_id' => $account->id(),
    ]);
    $conductor->save();
    $run = $entity_type_manager->getStorage('bb_run')->create([
      'conductor_id' => $conductor->id(),
      'owner_user_id' => $account->id(),
      'state' => 'claimed',
    ]);
    $run->save();
    $this->assertInstanceOf(ContentEntityInterface::class, $run);
    return $run;
  }

  /**
   * A run is visible to the account that owns its conductor, and to no other.
   */
  public function testRunQueryAccessMirrorsOwnerGrant(): void {
    $owner = $this->createUserWithPermissions('run-owner', ['register bakers conductor']);
    $stranger = $this->createUserWithPermissions('run-stranger', ['register bakers conductor']);

    $mine = $this->createRunOwnedBy($owner, 'mine');
    $theirs = $this->createRunOwnedBy($stranger, 'theirs');

    $this->assertSame([(int) $mine->id()], $this->queryAs('bb_run', $owner));
    $this->assertSame([(int) $theirs->id()], $this->queryAs('bb_run', $stranger));
    $this->assertTrue($mine->access('view', $owner));
    $this->assertFalse($theirs->access('view', $owner));
  }

  /**
   * The `view bb_run` holder still sees every run — the grant only widens.
   */
  public function testRunViewPermissionIsNotNarrowed(): void {
    $reader = $this->createUserWithPermissions('run-reader', ['view bb_run']);
    $other = $this->createUserWithPermissions('run-other', ['register bakers conductor']);
    $entity_type_manager = $this->container->get('entity_type.manager');

    // BB-318 reaches a run's project through its ticket, so the rows need one
    // — a run hanging off no ticket is outside every workspace by construction.
    $project = $this->createProjectMemberOf($reader);
    $ticket = $entity_type_manager->getStorage('bb_ticket')->create([
      'identifier' => 'GL-OG',
      'workflow' => 'bb_work',
      'title' => 'GL-OG',
      'project_id' => $project->id(),
    ]);
    $ticket->save();
    $conductor = $entity_type_manager->getStorage('bb_conductor')->create([
      'label' => 'c-other',
      'owner_user_id' => $other->id(),
      'project_id' => $project->id(),
    ]);
    $conductor->save();
    foreach (range(1, 2) as $unused_index) {
      unset($unused_index);
      $entity_type_manager->getStorage('bb_run')->create([
        'conductor_id' => $conductor->id(),
        'ticket_id' => $ticket->id(),
        'owner_user_id' => $other->id(),
        'state' => 'claimed',
      ])->save();
    }

    $this->assertCount(2, $this->queryAs('bb_run', $reader));
  }

  /**
   * The owner condition carries the `user` cache context (spec R8).
   *
   * The condition varies per account, so anything caching a response built on
   * it must vary per account too. A missing context leaks one account's rows
   * into another's cached response — the kind of defect that only shows up
   * under a warm cache, which is why it is pinned here rather than reasoned
   * about.
   */
  public function testOwnerConditionVariesPerUser(): void {
    $owner = $this->createUserWithPermissions('ctx-owner', ['register bakers conductor']);

    $handler = $this->container->get('entity_type.manager')
      ->getHandler('bb_run', 'query_access');
    $this->assertInstanceOf(QueryAccessHandlerInterface::class, $handler);
    $conditions = $handler->getConditions('view', $owner);

    $this->assertContains('user', $conditions->getCacheContexts());
  }

}
