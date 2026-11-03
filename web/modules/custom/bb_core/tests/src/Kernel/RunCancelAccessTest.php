<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies that run cancellation follows ticket edit access and no further.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunCancelAccessTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->createUser('uid1-dummy');
  }

  /**
   * A ticket editor can cancel a run owned by another conductor.
   */
  public function testTicketEditorMayCancelRunOwnedByAnotherConductor(): void {
    $editor = $this->createUserWithPermissions('ticket-editor', [
      'view bb_ticket', 'update any bb_ticket', 'register bakers conductor',
    ]);
    $owner = $this->createUserWithPermissions('run-owner', ['register bakers conductor']);
    $run = $this->createRun($owner);

    $this->assertTrue($run->access('update', $editor));
    $state_access = $run->get('state')->access('edit', $editor, TRUE);
    $this->assertTrue($state_access->isAllowed());
    $this->assertContains(
      'bb_ticket:' . $run->get('ticket_id')->target_id,
      CacheableMetadata::createFromObject($state_access)->getCacheTags(),
    );
  }

  /**
   * A user who cannot edit the ticket cannot cancel its run.
   */
  public function testNonEditorMayNotCancel(): void {
    $viewer = $this->createUserWithPermissions('ticket-viewer', ['view bb_ticket']);
    $owner = $this->createUserWithPermissions('run-owner', ['register bakers conductor']);
    $run = $this->createRun($owner);

    $this->assertFalse($run->access('update', $viewer));
  }

  /**
   * Ticket edit access grants only the run state field, not telemetry fields.
   */
  public function testTicketEditorStillMayNotWriteRunTelemetry(): void {
    $editor = $this->createUserWithPermissions('ticket-editor', [
      'view bb_ticket', 'update any bb_ticket', 'register bakers conductor',
    ]);
    $owner = $this->createUserWithPermissions('run-owner', ['register bakers conductor']);
    $run = $this->createRun($owner);

    $this->assertFalse($run->get('heartbeat')->access('edit', $editor));
    $this->assertFalse($run->get('worktree_path')->access('edit', $editor));
  }

  /**
   * A ticket editor with no conductor registration may cancel and no more.
   *
   * Without `register bakers conductor`, `checkFieldAccess()` used to skip its
   * whole body and fall through to core's default, which allows every field
   * (BB-536 review-3, finding 2). This is the account the feature exists
   * for — an operator with no conductor of their own.
   */
  public function testTicketEditorWithoutConductorRoleMayOnlyCancel(): void {
    $editor = $this->createUserWithPermissions('ticket-editor-no-conductor', [
      'view bb_ticket', 'update any bb_ticket',
    ]);
    $owner = $this->createUserWithPermissions('run-owner', ['register bakers conductor']);
    $run = $this->createRun($owner);

    $this->assertTrue($run->access('update', $editor));
    $this->assertTrue($run->get('state')->access('edit', $editor));
    $this->assertFalse($run->get('heartbeat')->access('edit', $editor));
    $this->assertFalse($run->get('closed')->access('edit', $editor));
  }

  /**
   * Creates an account with a private role carrying the given permissions.
   *
   * @param string $name
   *   The account name.
   * @param array<int, string> $permissions
   *   Permissions for the account's role.
   *
   * @return \Drupal\user\UserInterface
   *   The saved account.
   */
  private function createUserWithPermissions(string $name, array $permissions): UserInterface {
    $role_id = str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    user_role_grant_permissions($role_id, $permissions);
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a plain account used as the schema's UID 1 placeholder.
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a running run whose conductor belongs to a different user.
   */
  private function createRun(UserInterface $owner): BbRunInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_project');
    $project = $storage->create(['name' => 'Access project']);
    $project->save();

    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')
      ->create([
        'label' => 'access-node',
        'owner_user_id' => $owner->id(),
        'status' => 'online',
        'project_id' => $project->id(),
      ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();

    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => 'ACCESS-' . mt_rand(),
        'workflow' => 'bb_work',
        'title' => 'Access ticket',
        'project_id' => $project->id(),
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();

    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')
      ->create([
        'ticket_id' => $ticket->id(),
        'conductor_id' => $conductor->id(),
        'state' => 'running',
        'heartbeat' => 1700000000,
        'worktree_path' => '/tmp/access-run',
      ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();
    return $run;
  }

}
