<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Unit;

use Drupal\island\IslandRuntimeId;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Runtime identity must distinguish every application/profile/instance tuple.
 */
#[Group('island')]
final class IslandRuntimeIdTest extends UnitTestCase {

  /**
   * Underscores in independently assigned identities do not merge boundaries.
   */
  public function testTupleBoundariesCannotCollide(): void {
    self::assertNotSame(
      IslandRuntimeId::forPlacement('a_b', 'c', 'd', 'placement'),
      IslandRuntimeId::forPlacement('a', 'b_c', 'd', 'placement'),
    );
    self::assertNotSame(
      IslandRuntimeId::forPlacement('a', 'b', 'c/d', 'placement'),
      IslandRuntimeId::forPlacement('a', 'b', 'c d', 'placement'),
    );
  }

}
