<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * Pins which roles the time-series figures are disclosed to.
 *
 * The three model trends mirror their `*_models` snapshot siblings' grants
 * exactly (workspace lead). `team_members_tickets_trend` names every
 * member's numbers on one page, so it follows the `by_user` disclosure
 * class: the team lead role only, never the plain member role.
 * Asserted on the shipped role config in BOTH homes.
 */
#[Group('bb_core')]
final class SeriesFigureDisclosureTest extends UnitTestCase {

  private const WORKSPACE_LEAD = 'og.og_role.bb_workspace-bb_workspace-lead';
  private const TEAM_LEAD = 'og.og_role.bb_team-bb_team-lead';
  private const TEAM_MEMBER = 'og.og_role.bb_team-bb_team-member';

  /**
   * The workspace lead sees the team- and project-scoped model trends.
   */
  public function testWorkspaceLeadSeesTheModelTrends(): void {
    foreach ($this->permissions(self::WORKSPACE_LEAD) as $file => $permissions) {
      self::assertContains('view bakers figure team_models_trend', $permissions, "$file grants the team model trend");
      self::assertContains('view bakers figure project_models_trend', $permissions, "$file grants the project model trend");
    }
  }

  /**
   * The workspace lead does not see the per-user model trend.
   */
  public function testWorkspaceLeadDoesNotSeeTheUserModelTrend(): void {
    foreach ($this->permissions(self::WORKSPACE_LEAD) as $file => $permissions) {
      self::assertNotContains('view bakers figure user_models_trend', $permissions, "$file withholds the user model trend");
    }
  }

  /**
   * A team lead is granted the user-scope model trend.
   */
  public function testTeamLeadSeesTheUserModelTrend(): void {
    foreach ($this->permissions(self::TEAM_LEAD) as $file => $permissions) {
      self::assertContains('view bakers figure user_models_trend', $permissions, "$file grants the user model trend");
      self::assertContains('view bakers figure user_tokens_trend', $permissions, "$file already grants the user tokens trend");
    }
  }

  /**
   * A team lead is granted the per-member ticket trend.
   */
  public function testTeamLeadSeesTheMemberTicketTrend(): void {
    foreach ($this->permissions(self::TEAM_LEAD) as $file => $permissions) {
      self::assertContains('view bakers figure team_members_tickets_trend', $permissions, "$file grants the team lead");
    }
  }

  /**
   * A plain team member is not granted the per-member ticket trend.
   */
  public function testTeamMemberDoesNotSeeTheMemberTicketTrend(): void {
    foreach ($this->permissions(self::TEAM_MEMBER) as $file => $permissions) {
      self::assertNotContains('view bakers figure team_members_tickets_trend', $permissions, "$file withholds the team member");
    }
  }

  /**
   * Reads the granted permissions for one role from both shipped homes.
   *
   * @return array<string, array<string>>
   *   Permissions keyed by the absolute file path they were read from.
   */
  private function permissions(string $role): array {
    $root = dirname(__DIR__, 7);
    $files = [
      $root . '/config/sync/' . $role . '.yml',
      $root . '/web/modules/custom/bb_core/config/install/' . $role . '.yml',
    ];
    $permissions = [];
    foreach ($files as $file) {
      self::assertFileExists($file);
      $permissions[$file] = Yaml::parseFile($file)['permissions'] ?? [];
    }
    return $permissions;
  }

}
