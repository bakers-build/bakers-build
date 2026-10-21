<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Authentication;

use Drupal\Core\Authentication\AuthenticationProviderInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\user\Authentication\Provider\Cookie;
use Drupal\user\UserInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\ResponseEvent;

/**
 * Never authenticates a cookie session as a service account.
 *
 * Every interactive sign-in path (password, one-time link, login code,
 * OAuth account link) ends in a cookie session, so this is the one shared
 * boundary: whatever path a session for a service account came from, no
 * request is ever served as that identity. The request continues anonymous.
 *
 * Decoration moves the inner provider's `event_subscriber` tag onto this
 * service, so its response listener is forwarded unchanged.
 */
final class ServiceAccountCookieProvider implements AuthenticationProviderInterface, EventSubscriberInterface {

  public function __construct(
    private readonly AuthenticationProviderInterface $inner,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ServiceAccountManager $serviceAccountManager,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function applies(Request $request): bool {
    return $this->inner->applies($request);
  }

  /**
   * {@inheritdoc}
   */
  public function authenticate(Request $request) {
    $account = $this->inner->authenticate($request);
    if ($account === NULL || $account->isAnonymous()) {
      return $account;
    }
    $user = $this->entityTypeManager->getStorage('user')->load($account->id());
    if ($user instanceof UserInterface && $this->serviceAccountManager->isServiceAccount($user)) {
      return NULL;
    }
    return $account;
  }

  /**
   * Forwards core's login-redirect check to the decorated provider.
   */
  public function addCheckToUrl(ResponseEvent $event): void {
    if ($this->inner instanceof Cookie) {
      $this->inner->addCheckToUrl($event);
    }
  }

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return Cookie::getSubscribedEvents();
  }

}
