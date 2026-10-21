<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Within one workspace, TEAM membership decides tickets and runs (BB-462 D4).
 *
 * Rewritten from project membership to team membership: BB-462 deregisters
 * `bb_project` as an OG group entirely (D7), so a project membership row can
 * no longer exist to test. Visibility now follows `bb_project.teams`
 * instead — a project is visible exactly to members of a team it names.
 *
 * The distinguishing case is the second account: it holds a workspace
 * `member` membership in the same workspace and no team membership, so it
 * sees the workspace but none of its projects — which means neither the
 * project's tickets nor its runs. That is the difference between "a member of
 * the workspace" and "a member of one of its teams", and it is the only
 * assertion that shows the two are not the same set. The workspace `member`
 * role is empty by design (BB-462 D1), so this also demonstrates that an
 * account holding no explicit tier sees nothing beyond the workspace row
 * itself.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceReadScopeProjectTest extends KernelTestBase {

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
   * The permissions both actors hold, so only membership can explain a result.
   *
   * @var array<string>
   */
  private const READER_PERMISSIONS = [
    'view bb_workspace', 'view bb_project', 'view bb_ticket',
    'view bb_run',
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
   * A team member sees the project's tickets and runs (BB-462 D4).
   */
  public function testTeamMemberSeesTheProjectsTicketsAndRuns(): void {
    $account = $this->createAccount('team-member', self::READER_PERMISSIONS);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);

    self::assertContains(
      (int) $this->fixture('a', 'bb_ticket')->id(),
      $this->queryIdsAs('bb_ticket', $account),
    );
    self::assertContains(
      (int) $this->fixture('a', 'bb_run')->id(),
      $this->queryIdsAs('bb_run', $account),
    );
  }

  /**
   * A workspace-only member of the same workspace sees neither.
   */
  public function testWorkspaceOnlyMemberSeesNeitherTicketsNorRuns(): void {
    $account = $this->createAccount('workspace-only', self::READER_PERMISSIONS);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);

    self::assertSame(
      [],
      $this->queryIdsAs('bb_ticket', $account),
      'A workspace member is not automatically a member of its teams — OG '
      . 'has no inheritance, and this change does not invent one.',
    );
    self::assertSame(
      [],
      $this->queryIdsAs('bb_run', $account),
      "The run rule derives from the ticket rule, so it follows the ticket's "
      . 'verdict rather than restating it.',
    );
    // It does still see the workspace itself, which is what makes the two
    // previous assertions about the team rule and not about the membership.
    self::assertSame(
      [(int) $this->fixture('a', 'bb_workspace')->id()],
      $this->queryIdsAs('bb_workspace', $account),
    );
  }

  /**
   * A team membership without a workspace membership still scopes tickets.
   *
   * OG has no inheritance in either direction, so this state is expressible
   * and the class docblock of BbWorkspaceReadScope names it as the one
   * imprecision in the service's name. Asserting it here keeps the behaviour
   * deliberate.
   */
  public function testTeamMembershipAloneIsEnoughForItsTickets(): void {
    $account = $this->createAccount('team-only', self::READER_PERMISSIONS);
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);

    self::assertSame(
      [(int) $this->fixture('a', 'bb_ticket')->id()],
      $this->queryIdsAs('bb_ticket', $account),
    );
    self::assertSame(
      [],
      $this->queryIdsAs('bb_workspace', $account),
      'No workspace membership means no workspace row.',
    );
  }

}
