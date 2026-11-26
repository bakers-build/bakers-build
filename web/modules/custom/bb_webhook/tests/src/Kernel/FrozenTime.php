<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_webhook\Kernel;

use Drupal\Component\Datetime\TimeInterface;

/**
 * A clock the delivery tests move by hand.
 */
final class FrozenTime implements TimeInterface {

  /**
   * The current Unix time.
   */
  public int $now = 1800000000;

  /**
   * {@inheritdoc}
   */
  public function getRequestTime(): int {
    return $this->now;
  }

  /**
   * {@inheritdoc}
   */
  public function getRequestMicroTime(): float {
    return $this->now;
  }

  /**
   * {@inheritdoc}
   */
  public function getCurrentTime(): int {
    return $this->now;
  }

  /**
   * {@inheritdoc}
   */
  public function getCurrentMicroTime(): float {
    return $this->now;
  }

}
