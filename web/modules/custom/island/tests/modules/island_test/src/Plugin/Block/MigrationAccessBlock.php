<?php

declare(strict_types=1);

namespace Drupal\island_test\Plugin\Block;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Block\Attribute\Block;
use Drupal\Core\Block\BlockBase;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * A configured, permission-protected block used by migration rendering tests.
 */
#[Block(
  id: 'island_test_migration_access',
  admin_label: new TranslatableMarkup('Migration access fixture'),
)]
final class MigrationAccessBlock extends BlockBase {

  /**
   * {@inheritdoc}
   */
  protected function blockAccess(AccountInterface $account) {
    return AccessResult::allowedIfHasPermission($account, 'administer site configuration');
  }

  /**
   * {@inheritdoc}
   */
  public function build(): array {
    return ['#plain_text' => $this->configuration['marker'] ?? 'Protected block'];
  }

}
