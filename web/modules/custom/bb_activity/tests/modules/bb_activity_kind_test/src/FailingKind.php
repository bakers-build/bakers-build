<?php

declare(strict_types=1);

namespace Drupal\bb_activity_kind_test;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_activity\Activity\ActivityKindBase;
use Drupal\bb_activity\Entity\BbActivity;

/**
 * Stands in for a shipped kind and fails while recording.
 */
final class FailingKind extends ActivityKindBase {

  /**
   * {@inheritdoc}
   */
  public function record(): ?BbActivity {
    throw new \RuntimeException('kind failed');
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function messages(BbActivity $activity, AccountInterface $reader, string $langcode): array {
    return [];
  }

}
