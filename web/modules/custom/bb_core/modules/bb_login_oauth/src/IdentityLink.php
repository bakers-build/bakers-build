<?php

declare(strict_types=1);

namespace Drupal\bb_login_oauth;

use Drupal\Core\Entity\EntityTypeManagerInterface;

/**
 * Answers whether an account is linked to an OAuth provider.
 */
final class IdentityLink {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Whether the given account holds at least one social_auth link.
   */
  public function isLinked(int $uid): bool {
    $count = $this->entityTypeManager->getStorage('social_auth')
      ->getQuery()
      ->condition('user_id', $uid)
      ->range(0, 1)
      // A system fact about the account, not a viewer's read permission.
      ->accessCheck(FALSE)
      ->count()
      ->execute();

    return $count > 0;
  }

}
