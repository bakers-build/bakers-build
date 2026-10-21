<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Session\AccountProxyInterface;

/**
 * Owner-scoped reads shared by personal time operations.
 */
final class WorkTimeRecords {

  /**
   * Constructs owner-scoped reads.
   */
  public function __construct(private AccountProxyInterface $account, private ConfigFactoryInterface $configFactory) {}

  /**
   * Requires an authenticated current owner for every operation.
   */
  public function owner(): int {
    if (!$this->account->isAuthenticated()) {
      throw new \DomainException('Sign in to access personal time.');
    }
    return (int) $this->account->id();
  }

  /**
   * Captures the existing user/site/UTC fallback for activity ingestion.
   */
  public function timezone(): string {
    return $this->account->getTimeZone() ?: ($this->configFactory->get('system.date')->get('timezone.default') ?: 'UTC');
  }

}
