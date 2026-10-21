<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The stock query access handler mirrors checkAccess() on the other six types.
 *
 * None of bb_ticket, bb_comment, bb_project, bb_environment, bb_group
 * or bb_term narrows `view` in its access control handler, so the entity
 * module's QueryAccessHandler is a faithful mirror. bb_project is the one
 * worth asserting rather than assuming: it extends CORE's access handler and
 * hand-maps operations to permission strings, and it mirrors only because its
 * `view` string happens to equal the one the handler derives (spec fact 6).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class StockQueryAccessMirrorTest extends KernelTestBase {

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
      'user', 'og_membership', 'bb_workspace', 'bb_group',
      'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_run', 'bb_comment', 'bb_environment', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['uid' => 1, 'name' => 'uid1-dummy', 'status' => 1])->save();
  }

  /**
   * Creates a user holding exactly the given permissions.
   *
   * @param string $name
   *   The user name, also used to derive a dedicated role id.
   * @param array<string> $permissions
   *   The permissions to grant.
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
   * A holder of `view <type>` sees every row in its scope; a non-holder none.
   *
   * The rows sit in a real workspace chain and the reader holds a membership in
   * it, which BB-318 made necessary: the read scope narrows the
   * permission-derived group, so a bare row outside every workspace is
   * invisible to everyone but an `administer bakers` holder. What the class
   * asserts is unchanged — that for these types the stock handler's verdict is
   * the permission's verdict and agrees with checkAccess() row by row.
   */
  public function testViewPermissionDecidesEveryRow(): void {
    $entity_type_manager = $this->container->get('entity_type.manager');
    $workspace = $entity_type_manager->getStorage('bb_workspace')
      ->create(['name' => 'w']);
    $this->assertInstanceOf(ContentEntityInterface::class, $workspace);
    $workspace->save();
    $group = $entity_type_manager->getStorage('bb_group')
      ->create(['name' => 'g', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $entity_type_manager->getStorage('bb_project')
      ->create(['name' => 'p', 'group_id' => $group->id()]);
    $project->save();
    $cases = [
      'bb_ticket' => ['title' => 't', 'project_id' => $project->id()],
      'bb_project' => $project,
      'bb_environment' => ['name' => 'e', 'project_id' => $project->id()],
      'bb_group' => $group,
    ];

    foreach ($cases as $entity_type_id => $values) {
      if (is_array($values)) {
        $entity = $entity_type_manager->getStorage($entity_type_id)->create($values);
        $entity->save();
      }
      else {
        // bb_project and bb_group ARE the scoped row, so the chain built
        // above is the case rather than a container for it.
        $entity = $values;
      }

      $reader = $this->createUserWithPermissions('rd_' . $entity_type_id, ['view ' . $entity_type_id]);
      $nobody = $this->createUserWithPermissions('nb_' . $entity_type_id, []);
      // A workspace membership carrying `admin`: it reaches the workspace, its
      // group and every project of it, which is exactly the set these four rows
      // live in. The negative half of every assertion still uses an account
      // with neither the permission nor a membership.
      $this->addMembership($workspace, $reader, ['lead']);

      $this->container->get('account_switcher')->switchTo($reader);
      $visible = $entity_type_manager->getStorage($entity_type_id)->getQuery()
        ->accessCheck(TRUE)->execute();
      $this->container->get('account_switcher')->switchBack();

      $this->container->get('account_switcher')->switchTo($nobody);
      $hidden = $entity_type_manager->getStorage($entity_type_id)->getQuery()
        ->accessCheck(TRUE)->execute();
      $this->container->get('account_switcher')->switchBack();

      $this->assertCount(1, $visible, $entity_type_id . ': the permission holder sees the row.');
      $this->assertSame([], array_values($hidden), $entity_type_id . ': a non-holder sees nothing.');
      $this->assertTrue($entity->access('view', $reader), $entity_type_id . ': checkAccess agrees.');
      $this->assertFalse($entity->access('view', $nobody), $entity_type_id . ': checkAccess agrees.');
    }
  }

}
