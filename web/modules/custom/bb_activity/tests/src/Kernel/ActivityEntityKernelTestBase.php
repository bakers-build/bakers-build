<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Tests\bb_core\Kernel\BbEntityKernelTestBase;

/**
 * The bb_core entity fixture with bb_activity enabled and installed.
 */
abstract class ActivityEntityKernelTestBase extends BbEntityKernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->enableModules(['bb_activity']);
    $this->installEntitySchema('bb_activity');
    $this->installEntitySchema('bb_notification_setting');
  }

}
