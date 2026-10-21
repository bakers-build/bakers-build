<?php

declare(strict_types=1);

namespace Drupal\bb_login_oauth_test\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\bb_login_oauth\BbGoogleAuthManager;
use Drupal\social_auth\User\SocialAuthUser;
use Drupal\social_auth\User\UserAuthenticator;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * A provider that talks to nobody, for the browser suite.
 *
 * The OAuth traffic is server-side, so Playwright cannot stub Google. This
 * route builds a `SocialAuthUser` and drives `authenticateUser()`, the same
 * entry point the real callback uses, so the `getAdditionalData()` hop is
 * exercised too.
 */
final class StubProviderController extends ControllerBase {

  public function __construct(
    private readonly UserAuthenticator $userAuthenticator,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('social_auth.user_authenticator'));
  }

  /**
   * Hands the decorated authenticator a stubbed address and assertion.
   */
  public function callback(Request $request): RedirectResponse {
    $mail = (string) $request->query->get('mail', '');
    $verified = $request->query->get('verified') === '1';

    $user = new SocialAuthUser(
      $mail !== '' ? $mail : 'stub',
      'stub-' . md5($mail),
      'stub-token',
      $mail,
      NULL,
      [BbGoogleAuthManager::VERIFIED_KEY => $verified],
    );

    $this->userAuthenticator->setPluginId('social_auth_google');
    return $this->userAuthenticator->authenticateUser($user);
  }

}
