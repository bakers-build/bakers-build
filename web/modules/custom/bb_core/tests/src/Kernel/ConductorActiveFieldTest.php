<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use PHPUnit\Framework\Attributes\Group;

/**
 * Tests the operator-set conductor active flag.
 */
#[Group('bb_core')]
final class ConductorActiveFieldTest extends ClaimKernelTestBase {

  /**
   * A new conductor defaults to active.
   */
  public function testNewConductorIsActive(): void {
    self::assertTrue((bool) $this->conductor->get('active')->value);
  }

  /**
   * Deactivation does not change automatic liveness.
   */
  public function testDeactivationLeavesStatusUntouched(): void {
    $this->conductor->set('status', 'online')->save();
    $this->conductor->set('active', FALSE)->save();

    self::assertFalse((bool) $this->conductor->get('active')->value);
    self::assertSame('online', (string) $this->conductor->get('status')->value);
  }

}
