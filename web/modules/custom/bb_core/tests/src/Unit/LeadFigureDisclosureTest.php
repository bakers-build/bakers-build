<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * Pins which composite figures the workspace lead is disclosed (BB-516).
 *
 * The lead (Admin) sees the team- and project-scoped token figures — the
 * aggregate ones — but not the per-user figures, matching BB-479's rule
 * that only a team lead sees per-user breakdowns. Asserted on the shipped
 * role config in BOTH homes, so a permission added to one and not the other
 * fails here rather than on a deploy.
 */
#[Group('bb_core')]
final class LeadFigureDisclosureTest extends UnitTestCase {

  private const ROLE = 'og.og_role.bb_workspace-bb_workspace-lead';

  /**
   * The team- and project-scoped figures the lead must see.
   *
   * @var array<string>
   */
  private const GRANTED = [
    'view bakers figure project_models',
    'view bakers figure project_tickets_trend',
    'view bakers figure team_models',
    'view bakers figure team_tickets_trend',
  ];

  /**
   * The per-user figures the lead must NOT see.
   *
   * @var array<string>
   */
  private const WITHHELD = [
    'view bakers figure user_models',
    'view bakers figure user_tickets_trend',
  ];

  /**
   * Every home grants the aggregate figures and withholds the per-user ones.
   */
  public function testLeadDisclosureIsConsistentAcrossHomes(): void {
    foreach ($this->homes() as $file) {
      self::assertFileExists($file);
      $permissions = Yaml::parseFile($file)['permissions'] ?? [];
      foreach (self::GRANTED as $permission) {
        self::assertContains($permission, $permissions, "$file grants $permission");
      }
      foreach (self::WITHHELD as $permission) {
        self::assertNotContains($permission, $permissions, "$file withholds $permission");
      }
    }
  }

  /**
   * The two shipped copies of the role config.
   *
   * @return array<string>
   *   Absolute paths to the config/sync and config/install copies.
   */
  private function homes(): array {
    $root = dirname(__DIR__, 7);
    return [
      $root . '/config/sync/' . self::ROLE . '.yml',
      $root . '/web/modules/custom/bb_core/config/install/' . self::ROLE . '.yml',
    ];
  }

}
