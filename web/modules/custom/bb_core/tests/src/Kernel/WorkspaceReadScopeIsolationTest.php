<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\EventSubscriber\WorkspaceReadScopeSubscriber;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A collection query returns the account's own workspace and no other (V1).
 *
 * AC 1, one case per in-scope entity type, table-driven. The table's keys are
 * asserted against the subscriber's own in-scope list, so a type narrowed
 * without a case here — or a case here for a type nothing narrows — fails
 * loudly rather than passing by omission.
 *
 * `bb_term` joined the set in BB-339: it now carries a required
 * `workspace_id`, which closed the gap BB-318 recorded rather than forgot.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceReadScopeIsolationTest extends KernelTestBase {

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
   * Every read permission an actor needs to reach all in-scope types at all.
   *
   * Without these the rows are invisible by permission and the test would pass
   * without the read scope existing.
   *
   * @var array<string>
   */
  private const READER_PERMISSIONS = [
    'view bb_workspace', 'view bb_group', 'view bb_team',
    'view bb_project',
    'view bb_ticket', 'view bb_ticket_template', 'view bb_environment', 'view bb_conductor',
    'view bb_machine',
    'view bb_run', 'view bb_comment', 'view bb_term', 'view bb_invite',
    'access user profiles',
    // BB-391: `og_membership` joined the narrowed set, and its rows are
    // invisible by permission without this — which would make the isolation
    // assertion below pass without the rule existing.
    'view bakers memberships',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
  }

  /**
   * The test's table and the subscriber's registration describe the same set.
   */
  public function testTheInScopeSetIsTheSubscribersOwn(): void {
    $registered = array_keys(WorkspaceReadScopeSubscriber::getSubscribedEvents());
    $expected = [];
    foreach (array_keys(self::inScopeEntityTypes()) as $entity_type_id) {
      $expected[] = 'entity.query_access.' . $entity_type_id;
    }
    sort($expected);
    sort($registered);
    self::assertSame($expected, $registered);
    self::assertContains(
      'entity.query_access.bb_term',
      $registered,
      'bb_term is workspace-scoped since BB-339; the bridge must narrow it.',
    );
  }

  /**
   * Workspace A's member sees A's row of every type and none of B's.
   */
  public function testEveryInScopeTypeIsolatesAcrossWorkspaces(): void {
    $account = $this->createAccount('isolated-a', self::READER_PERMISSIONS);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership — a project membership row will not exist
    // at all once BB-462 Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);

    foreach (array_keys(self::inScopeEntityTypes()) as $entity_type_id) {
      $visible = $this->queryIdsAs($entity_type_id, $account);
      [$mine, $theirs] = $this->rowsUnderTest($entity_type_id, $account);

      self::assertContains(
        $mine,
        $visible,
        "A member of workspace A must still see A's $entity_type_id row.",
      );
      self::assertNotContains(
        $theirs,
        $visible,
        "A member of workspace A must not see B's $entity_type_id row.",
      );
    }
  }

  /**
   * A workspace template does not open the project templates of the workspace.
   *
   * A member who reads no project of the workspace sees its workspace
   * templates, but no project's template through the workspace term.
   */
  public function testProjectTemplateNotVisibleThroughWorkspace(): void {
    $account = $this->createAccount('teamless-a', self::READER_PERMISSIONS);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    $workspace_template = $this->createEntity('bb_ticket_template', [
      'name' => 'workspace-template-a',
      'enabled' => TRUE,
      'title_pattern' => 'workspace-template-a',
      'description' => ['value' => 'Body', 'format' => 'plain_text'],
      'workflow' => 'bb_work',
      'target_state' => 'qualification',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    self::assertNotContains((int) $this->fixture('a', 'bb_project')->id(), $this->queryIdsAs('bb_project', $account), 'Precondition: the project is not readable.');

    $visible = $this->queryIdsAs('bb_ticket_template', $account);
    self::assertContains((int) $workspace_template->id(), $visible);
    self::assertNotContains((int) $this->fixture('a', 'bb_ticket_template')->id(), $visible);
  }

  /**
   * An account with no membership sees nothing of the eight bakers.build types.
   *
   * D7 guard 3, and the reason it is a falsified group rather than an empty
   * `IN` list: an empty list is a database-level accident waiting to differ per
   * driver. `user` is excluded because its set always holds the account itself.
   */
  public function testNoMembershipYieldsNoRows(): void {
    $stranger = $this->createAccount('isolated-none', self::READER_PERMISSIONS);

    foreach (array_keys(self::inScopeEntityTypes()) as $entity_type_id) {
      if ($entity_type_id === 'user') {
        continue;
      }
      self::assertSame(
        [],
        $this->queryIdsAs($entity_type_id, $stranger),
        "An account with no membership sees no $entity_type_id row.",
      );
    }
  }

  /**
   * The admin permission is untouched, which keeps uid 1 and drush working.
   *
   * D7 guard 2. Without it this change revokes access from the only account
   * that currently has full access — including the whole Playwright suite (Fact
   * 8).
   */
  public function testTheAdminPermissionBypassesTheReadScope(): void {
    $admin = $this->createAccount('isolated-admin', ['administer bakers']);

    foreach (array_keys(self::inScopeEntityTypes()) as $entity_type_id) {
      if ($entity_type_id === 'user') {
        continue;
      }
      $visible = $this->queryIdsAs($entity_type_id, $admin);
      self::assertContains((int) $this->fixture('a', $entity_type_id)->id(), $visible);
      self::assertContains((int) $this->fixture('b', $entity_type_id)->id(), $visible);
    }
  }

  /**
   * Returns the id that must be visible and the id that must not, per type.
   *
   * `user` is the one type whose two rows are not fixture entities: the account
   * itself must be visible (D5) and the other workspace's member must not.
   *
   * @param string $entity_type_id
   *   The entity type under test.
   * @param \Drupal\user\UserInterface $account
   *   The acting account.
   *
   * @return array{int, int}
   *   The id expected to be visible, then the id expected to be hidden.
   */
  private function rowsUnderTest(string $entity_type_id, UserInterface $account): array {
    if ($entity_type_id === 'user') {
      return [(int) $account->id(), (int) $this->member('b')->id()];
    }
    return [
      (int) $this->fixture('a', $entity_type_id)->id(),
      (int) $this->fixture('b', $entity_type_id)->id(),
    ];
  }

}
