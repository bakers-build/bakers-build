<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\RunLog;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Reading a run's logs follows editing its ticket, not viewing the run.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunLogAccessTest extends KernelTestBase {

  /**
   * The fields that carry a log's content, file reference or checksum.
   */
  private const LOG_FIELDS = [
    'log', 'error_log', 'log_file', 'error_log_file', 'log_sha256', 'error_log_sha256',
  ];

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
      'bb_conductor', 'bb_ticket', 'bb_run', 'file',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    // Consume uid 1, which bypasses every access check.
    $this->createUserWithPermissions('uid1-dummy', []);
  }

  /**
   * A reader who may view the run but not edit its ticket gets no log.
   */
  public function testRunViewerMayNotViewLog(): void {
    $viewer = $this->createUserWithPermissions('run-viewer', ['view bb_ticket', 'view bb_run']);
    $run = $this->createRun($this->createUserWithPermissions('run-owner', ['register bakers conductor']));

    $this->assertTrue($run->access('view', $viewer));
    $this->assertFalse($run->access('view_log', $viewer));
  }

  /**
   * A ticket editor reads the logs of a run another conductor owns.
   */
  public function testTicketEditorMayViewLog(): void {
    $editor = $this->createUserWithPermissions('ticket-editor', [
      'view bb_ticket', 'view bb_run', 'update any bb_ticket',
    ]);
    $run = $this->createRun($this->createUserWithPermissions('run-owner', ['register bakers conductor']));

    $this->assertTrue($run->access('view_log', $editor));
  }

  /**
   * The run's conductor owner keeps reading its logs.
   */
  public function testConductorOwnerMayViewLog(): void {
    $owner = $this->createUserWithPermissions('run-owner', ['register bakers conductor']);
    $run = $this->createRun($owner);

    $this->assertTrue($run->access('view_log', $owner));
  }

  /**
   * Log content, file references and checksums stay hidden; sizes do not.
   */
  public function testLogFieldsHiddenFromRunViewer(): void {
    $viewer = $this->createUserWithPermissions('run-viewer', ['view bb_ticket', 'view bb_run']);
    $editor = $this->createUserWithPermissions('ticket-editor', [
      'view bb_ticket', 'view bb_run', 'update any bb_ticket',
    ]);
    $run = $this->createRun($this->createUserWithPermissions('run-owner', ['register bakers conductor']));

    foreach (self::LOG_FIELDS as $field) {
      $this->assertFalse($run->get($field)->access('view', $viewer), "$field is hidden from a run viewer.");
      $this->assertTrue($run->get($field)->access('view', $editor), "$field is visible to a ticket editor.");
    }
    $this->assertTrue($run->get('log_bytes')->access('view', $viewer));
    $this->assertTrue($run->get('state')->access('view', $viewer));
  }

  /**
   * Creates a user holding exactly the given permissions.
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
   * Creates a run whose conductor belongs to the given owner.
   */
  private function createRun(UserInterface $owner): BbRunInterface {
    $etm = $this->container->get('entity_type.manager');
    $project = $etm->getStorage('bb_project')->create(['name' => 'Log project']);
    $project->save();
    $conductor = $etm->getStorage('bb_conductor')->create([
      'conductor_id' => 'log-node',
      'label' => 'log-node',
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => $project->id(),
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    $ticket = $etm->getStorage('bb_ticket')->create([
      'identifier' => 'LOG-1',
      'workflow' => 'bb_work',
      'title' => 'Log ticket',
      'project_id' => $project->id(),
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();
    return $run;
  }

}
