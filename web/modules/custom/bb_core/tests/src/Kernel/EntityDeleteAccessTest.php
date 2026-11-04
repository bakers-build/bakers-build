<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Who may delete each deletable type, and who may not.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EntityDeleteAccessTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * The workspace content a workspace lead deletes.
   */
  private const array WORKSPACE_CONTENT = [
    'bb_ticket', 'bb_project', 'bb_team', 'bb_group', 'bb_environment',
    'bb_comment', 'bb_ticket_template', 'bb_term', 'bb_invite',
  ];

  /**
   * The types only a site administrator deletes.
   */
  private const array ADMIN_TYPES = ['bb_conductor', 'bb_machine', 'bb_workspace'];

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installEntitySchema('bb_invite');
    $this->buildTwoWorkspaceWorld();
  }

  /**
   * The entity of a type on side 'a', with an invite created on demand.
   */
  private function subject(string $type): ContentEntityInterface {
    if ($type !== 'bb_invite') {
      return $this->fixture('a', $type);
    }
    return $this->createEntity('bb_invite', [
      'email' => 'invitee@example.com',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
    ]);
  }

  /**
   * A lead deletes the workspace's content; a guest and a foreign lead cannot.
   */
  public function testWorkspaceLeadDeletesWorkspaceContent(): void {
    $lead = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $lead, ['lead']);
    $guest = $this->createAccount('guest-a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $guest, ['guest']);
    $foreign = $this->member('b');
    $this->addMembership($this->fixture('b', 'bb_workspace'), $foreign, ['lead']);

    foreach (self::WORKSPACE_CONTENT as $type) {
      $entity = $this->subject($type);
      self::assertTrue($entity->access('delete', $lead), "lead deletes $type");
      self::assertFalse($entity->access('delete', $guest), "guest cannot delete $type");
      self::assertFalse($entity->access('delete', $foreign), "foreign lead cannot delete $type");
    }
    foreach (self::ADMIN_TYPES as $type) {
      self::assertFalse($this->fixture('a', $type)->access('delete', $lead), "lead cannot delete $type");
    }
  }

  /**
   * A team lead deletes the projects of the team.
   */
  public function testTeamLeadDeletesTheTeamsProject(): void {
    $account = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_team'), $account, ['lead']);
    self::assertTrue($this->fixture('a', 'bb_project')->access('delete', $account));
    self::assertFalse($this->fixture('b', 'bb_project')->access('delete', $account));
  }

  /**
   * A site administrator deletes the admin entities.
   */
  public function testSiteAdminDeletesAdminEntities(): void {
    $admin = $this->createAccount('site-admin', ['administer bakers']);
    foreach (self::ADMIN_TYPES as $type) {
      self::assertTrue($this->fixture('a', $type)->access('delete', $admin), "admin deletes $type");
    }
  }

}
