<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Authentication;

use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\user\UserAuthenticationInterface;
use Drupal\user\UserAuthInterface;
use Drupal\user\UserInterface;

/**
 * Refuses username/password authentication for service accounts.
 *
 * Core's password login form and the `basic_auth` provider both resolve
 * credentials through `user.auth`; a service account is never found there,
 * so neither path can authenticate it, whatever password it might hold.
 */
final class ServiceAccountUserAuthentication implements UserAuthInterface, UserAuthenticationInterface {

  public function __construct(
    private readonly UserAuthInterface&UserAuthenticationInterface $inner,
    private readonly ServiceAccountManager $serviceAccountManager,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function authenticate($username, #[\SensitiveParameter] $password) {
    $account = $this->lookupAccount((string) $username);
    if ($account === FALSE) {
      return FALSE;
    }
    return $this->inner->authenticate($username, $password);
  }

  /**
   * {@inheritdoc}
   */
  public function lookupAccount($identifier): UserInterface|false {
    $account = $this->inner->lookupAccount($identifier);
    if ($account instanceof UserInterface && $this->serviceAccountManager->isServiceAccount($account)) {
      return FALSE;
    }
    return $account;
  }

  /**
   * {@inheritdoc}
   */
  public function authenticateAccount(UserInterface $account, #[\SensitiveParameter] string $password): bool {
    if ($this->serviceAccountManager->isServiceAccount($account)) {
      return FALSE;
    }
    return $this->inner->authenticateAccount($account, $password);
  }

}
