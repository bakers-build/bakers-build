<?php

declare(strict_types=1);

namespace Drupal\bb_login_oauth;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Drupal\Core\Messenger\MessengerInterface;
use Drupal\Core\Routing\RouteProviderInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\bb_login\Controller\BbOneTimeLoginController;
use Drupal\bb_login\EmailLogin;
use Drupal\social_auth\SocialAuthDataHandler;
use Drupal\social_auth\User\SocialAuthUserInterface;
use Drupal\social_auth\User\UserAuthenticator;
use Drupal\social_auth\User\UserManager;
use Psr\Log\LoggerInterface;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Gates provider e-mail matching on an address the provider confirmed.
 *
 * The social_auth module matches by e-mail unconditionally and bakers.build
 * keys accounts by e-mail, so matching an unconfirmed address is an account
 * takeover; no event can stop it, so decoration is the seam. Creation goes
 * through `EmailLogin::createAccount()` because registration is `admin_only`,
 * and the gated work runs on `$this` via `parent::`, never on a second
 * authenticator.
 *.
 */
final class VerifiedEmailAuthenticator extends UserAuthenticator {

  use StringTranslationTrait;

  /**
   * {@inheritdoc}
   *
   * The parent constructor must run: the controller calls
   * `authenticateUser()`, which reaches `authenticateWithEmail()` on this
   * object, and both need the parent's services initialized.
   *
   * @SuppressWarnings("PHPMD.ExcessiveParameterList")
   */
  public function __construct(
    AccountProxyInterface $current_user,
    MessengerInterface $messenger,
    LoggerChannelFactoryInterface $logger_factory,
    UserManager $user_manager,
    SocialAuthDataHandler $data_handler,
    ConfigFactoryInterface $config_factory,
    RouteProviderInterface $route_provider,
    EventDispatcherInterface $event_dispatcher,
    private readonly EmailLogin $emailLogin,
    private readonly LoggerInterface $logger,
    private readonly RequestStack $requestStack,
  ) {
    parent::__construct($current_user, $messenger, $logger_factory, $user_manager, $data_handler, $config_factory, $route_provider, $event_dispatcher);
  }

  /**
   * {@inheritdoc}
   *
   * `setSessionPrefix()` is the second half of what `OAuth2ControllerBase::
   * setUp()` does alongside `setPluginId()` (`social_auth.module`'s own
   * network-load hook does the same pairing) — `SocialApiDataHandler::
   * getSessionPrefix()` throws on an uninitialized property otherwise, which a
   * browser scenario reproduced on the real post-login redirect path.
   */
  public function setPluginId(string $plugin_id): void {
    parent::setPluginId($plugin_id);
    $this->dataHandler->setSessionPrefix($plugin_id);
  }

  /**
   * Whether the current request was refused for lack of a confirmed address.
   *
   * Lets {@see authenticateUser()} short-circuit before the inherited
   * fallthrough to account creation.
   */
  private bool $refusedUnverified = FALSE;

  /**
   * {@inheritdoc}
   *
   * SHORT-CIRCUITS ON A REFUSAL, rather than trusting the inherited
   * fallthrough. `UserAuthenticator::authenticateUser()` only skips
   * `createNewUser()` after a `FALSE` from `authenticateWithEmail()` because
   * `user.settings.register` is `admin_only` on this project — a fixture
   * fact, not a property this class enforces. If that setting ever changed,
   * an unconfirmed address would walk straight into a *new* account instead
   * of an existing one: the same takeover, one step later.
   */
  public function authenticateUser(SocialAuthUserInterface $user): RedirectResponse {
    $this->refusedUnverified = FALSE;
    $response = parent::authenticateUser($user);
    // PHPStan cannot see that parent::authenticateUser() reaches
    // $this->authenticateWithEmail() through late static binding and
    // mutates $refusedUnverified there, so it reads the flag as statically
    // FALSE from this vantage point. It is not.
    // @phpstan-ignore if.alwaysFalse
    if ($this->refusedUnverified) {
      // Undo the session state authenticateWithEmail() may have left behind,
      // and skip the parent's own registration-disabled message — this
      // class already told the visitor why, and a second, differently
      // worded message about site policy would be confusing.
      $this->nullifySessionKeys();
      $this->messenger->deleteByType('error');
      $this->messenger->addError($this->t('Google has not confirmed this address. Sign in with your e-mail address instead.'));
      return $this->getLoginFormRedirection();
    }
    return $this->applyPendingDestination($response);
  }

  /**
   * Hands a parked destination back to core, the way the mailed link does.
   *
   * `BbLoginForm::buildForm()` parks `?destination` in the session, since
   * the provider's callback URL carries none. It is put on the request, not
   * applied directly, so `RedirectResponseSubscriber` still refuses external
   * targets.
   *
   * @param \Symfony\Component\HttpFoundation\RedirectResponse $response
   *   The response `authenticateUser()` is about to answer with.
   *
   * @return \Symfony\Component\HttpFoundation\RedirectResponse
   *   The same response; the destination is applied through the request.
   */
  private function applyPendingDestination(RedirectResponse $response): RedirectResponse {
    $request = $this->requestStack->getCurrentRequest();
    if ($request === NULL || !$request->hasSession()) {
      return $response;
    }
    $session = $request->getSession();
    $destination = (string) $session->get(BbOneTimeLoginController::DESTINATION_KEY, '');
    if ($destination !== '') {
      // CONSUMED, not left standing: a destination that outlived this sign-in
      // would hijack the next one from this browser.
      $session->remove(BbOneTimeLoginController::DESTINATION_KEY);
      $request->query->set('destination', $destination);
    }
    return $response;
  }

  /**
   * {@inheritdoc}
   */
  public function authenticateWithEmail(string $email, string $provider_user_id, string $token, ?array $data): bool {
    // A MISSING ASSERTION IS A NO. The key is absent for any provider that has
    // not been taught to collect it, and defaulting an unknown to "verified"
    // is exactly the mistake this class exists to prevent.
    if (($data[BbGoogleAuthManager::VERIFIED_KEY] ?? FALSE) !== TRUE) {
      $this->refusedUnverified = TRUE;
      $this->logger->notice('Provider sign-in refused: address not confirmed by the provider.');
      return FALSE;
    }

    if (parent::authenticateWithEmail($email, $provider_user_id, $token, $data)) {
      return TRUE;
    }

    // No account holds this confirmed address: make one, the same way the
    // e-mail door does, then let the parent bind and log in.
    $account = $this->emailLogin->createAccount($email);
    if ($account === NULL) {
      $this->logger->error('Provider sign-in could not create an account.');
      $this->messenger->addError($this->t('Sign-in failed. Please try again.'));
      return FALSE;
    }

    return parent::authenticateWithEmail($email, $provider_user_id, $token, $data);
  }

}
