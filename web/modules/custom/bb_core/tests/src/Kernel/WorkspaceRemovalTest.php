<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Removal from a workspace ends the person's team seats there, and only there.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceRemovalTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

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
   * The person removed from workspace A.
   */
  private UserInterface $removed;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    $this->removed = $this->createAccount('removed');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->removed, ['contributor']);
    $this->addMembership($this->fixture('a', 'bb_team'), $this->removed, ['lead']);
    // A guest seat elsewhere keeps the tenant-blind Layer A `view bb_project`.
    $this->addMembership($this->fixture('b', 'bb_workspace'), $this->removed, ['guest']);
    $this->addMembership($this->fixture('b', 'bb_team'), $this->removed, ['member']);
    self::assertNotNull(Og::getMembership($this->fixture('a', 'bb_team'), $this->removed), 'fixture: team seat exists');

    $this->container->get('bb_core.membership_writer')
      ->remove($this->fixture('a', 'bb_workspace'), (int) $this->removed->id());
    self::assertNull(
      Og::getMembership($this->fixture('a', 'bb_workspace'), $this->removed, OgMembershipInterface::ALL_STATES),
      'fixture: the workspace membership itself is gone',
    );
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_project')->resetCache();
  }

  /**
   * No team membership of the workspace survives.
   */
  public function testNoTeamMembershipRemains(): void {
    self::assertNull(
      Og::getMembership($this->fixture('a', 'bb_team'), $this->removed, OgMembershipInterface::ALL_STATES),
      'the team membership in the removed workspace is gone',
    );
    self::assertNotNull(
      Og::getMembership($this->fixture('b', 'bb_team'), $this->removed),
      'a team of another workspace is untouched',
    );
  }

  /**
   * The workspace's project is neither editable nor deletable.
   */
  public function testProjectWriteIsDenied(): void {
    $project = $this->fixture('a', 'bb_project');
    self::assertFalse($project->access('update', $this->removed), 'the removed person may not edit the project');
    self::assertFalse($project->access('delete', $this->removed), 'the removed person may not delete the project');
  }

  /**
   * The project is not viewable.
   */
  public function testProjectViewIsDenied(): void {
    self::assertFalse($this->fixture('a', 'bb_project')->access('view', $this->removed), 'the removed person may not view the project');
  }

  /**
   * The project is out of the read scope and query access (JSON:API lists).
   */
  public function testProjectLeavesReadScopeAndListings(): void {
    $id = (int) $this->fixture('a', 'bb_project')->id();
    self::assertNotContains(
      $id,
      array_map('intval', $this->container->get('bb_core.workspace_read_scope')->projectIds($this->removed)),
      'the project leaves the read scope',
    );
    self::assertNotContains(
      $id,
      array_map('intval', $this->queryIdsAs('bb_project', $this->removed)),
      'the project leaves access-checked listings (JSON:API collection)',
    );
  }

}
