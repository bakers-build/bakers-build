<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_track\WorklogScope;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Team leads read the time of their team's active members, nobody else.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorklogScopeTest extends WorkTimeTestBase {

  use TeamWorldTrait;

  /**
   * The policy service under test.
   */
  private WorklogScope $scope;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->createTeamWorld();
    $this->scope = $this->container->get('bb_track.worklog_scope');
  }

  /**
   * A lead's scope lists active members and the team workspace's projects.
   */
  public function testLeadScopeListsActiveMembersAndWorkspaceProjects(): void {
    $w = $this->world;
    $owners = [(int) $w['O']->id(), (int) $w['L']->id(), (int) $w['M']->id(), (int) $w['WL']->id()];
    sort($owners);
    self::assertSame([
      [
        'team' => (int) $w['T1']->id(),
        'owners' => $owners,
        'projects' => [(int) $w['P1']->id()],
      ],
    ], $this->scope->ledTeamScopes($w['L']));
    self::assertTrue($this->scope->leads($w['L'], $w['T1']));
    self::assertFalse($this->scope->leads($w['L'], $w['T2']));
  }

  /**
   * Members, workspace leads and anonymous hold no team scope.
   */
  public function testMemberAndWorkspaceLeadHaveNoScope(): void {
    $w = $this->world;
    self::assertSame([], $this->scope->ledTeamScopes($w['M']));
    self::assertSame([], $this->scope->ledTeamScopes($w['WL']));
    self::assertSame([], $this->scope->ledTeamScopes(new AnonymousUserSession()));
    self::assertFalse($this->scope->leads($w['WL'], $w['T1']));
  }

  /**
   * Owning a team grants nothing; only the lead role does.
   *
   * The shipped og.settings gives group owners every group permission
   * (group_manager_full_access), so the scope must read the role itself.
   */
  public function testTeamOwnerWithoutLeadRoleHasNoScope(): void {
    $w = $this->world;
    $this->config('og.settings')->set('group_manager_full_access', TRUE)->save();
    $team = $this->container->get('entity_type.manager')->getStorage('bb_team')->create([
      'name' => 'Owned by the workspace lead',
      'workspace_id' => $w['W1']->id(),
      'owner_user_id' => $w['WL']->id(),
    ]);
    $team->save();
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $this->addMembership($team, $w['M']);
    $this->addMembership($team, $w['WL']);
    $this->scope->reset();
    self::assertSame([], $this->scope->ledTeamScopes($w['WL']));
    self::assertFalse($this->scope->leads($w['WL'], $team));
    self::assertSame([], $this->scope->ledTeamScopes($w['O']));
  }

  /**
   * Item view follows owner or led-team scope; voided rows stay owner-only.
   */
  public function testCanView(): void {
    $w = $this->world;
    $m_p1 = $this->teamEntry('M', 'P1');
    $m_p2 = $this->teamEntry('M', 'P2');
    $m2_p2 = $this->teamEntry('M2', 'P2');
    $m_voided = $this->teamEntry('M', 'P1', ['voided' => TRUE]);
    $mb_p1 = $this->teamEntry('Mb', 'P1');
    $l_p1 = $this->teamEntry('L', 'P1');
    self::assertTrue($this->scope->canView($m_p1, $w['L']));
    self::assertFalse($this->scope->canView($m_p2, $w['L']));
    self::assertFalse($this->scope->canView($m2_p2, $w['L']));
    self::assertFalse($this->scope->canView($m_voided, $w['L']));
    self::assertFalse($this->scope->canView($mb_p1, $w['L']));
    self::assertFalse($this->scope->canView($l_p1, $w['M']));
    self::assertFalse($this->scope->canView($m_p1, $w['WL']));
    self::assertTrue($this->scope->canView($m_p1, $w['M']));
    self::assertTrue($this->scope->canView($l_p1, $w['L']));
    self::assertFalse($this->scope->canView($m_p1, new AnonymousUserSession()));
  }

  /**
   * Person options per context.
   */
  public function testPeople(): void {
    $w = $this->world;
    $team = [
      (int) $w['L']->id() => 'lead-l',
      (int) $w['M']->id() => 'member-m',
      (int) $w['O']->id() => 'team-world-owner',
      (int) $w['WL']->id() => 'workspace-lead-wl',
    ];
    self::assertSame($team, $this->scope->people($w['L'], 'team', $w['T1']));
    self::assertSame($team, $this->scope->people($w['L'], 'project', $w['P1']));
    self::assertSame([(int) $w['M']->id() => 'member-m'], $this->scope->people($w['M'], 'project', $w['P1']));
    self::assertSame([], $this->scope->people($w['M'], 'team', $w['T1']));
    self::assertSame([], $this->scope->people($w['L'], 'workspace', $w['W1']));
  }

}
