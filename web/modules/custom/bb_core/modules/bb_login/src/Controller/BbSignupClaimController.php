<?php

declare(strict_types=1);

namespace Drupal\bb_login\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\bb_login\EmailLogin;
use Drupal\bb_login\LoginCode;
use Drupal\bb_login\PendingSignup;
use Drupal\bb_login\SignedInLanding;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Redeems a pending sign-up: the account is created here.
 *
 * The account is created when the mailed link is opened, rather than when
 * the address was typed. `EmailLogin::requestLoginLink()` mails this
 * controller's route for an unknown address instead of core's one-time
 * link, because that link's token derives from an account's uid, login
 * timestamp and password hash — none of which exist yet.
 */
final class BbSignupClaimController extends ControllerBase {

  use SignedInLanding;

  /**
   * Constructs the claim controller.
   *
   * @param \Drupal\bb_login\PendingSignup $pendingSignup
   *   Resolves the nonce to the address it stands for, consuming it.
   * @param \Drupal\bb_login\EmailLogin $emailLogin
   *   Finds an account that appeared meanwhile, or creates one.
   * @param \Drupal\bb_login\LoginCode $loginCode
   *   Voids the code from the same mail once the link is used.
   */
  public function __construct(
    private readonly PendingSignup $pendingSignup,
    private readonly EmailLogin $emailLogin,
    private readonly LoginCode $loginCode,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_login.pending_signup'),
      $container->get('bb_login.email_login'),
      $container->get('bb_login.login_code'),
    );
  }

  /**
   * Redeems a pending sign-up's nonce.
   *
   * @param string $nonce
   *   The nonce from the mailed link.
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The current request.
   *
   * @return \Symfony\Component\HttpFoundation\RedirectResponse
   *   A signed-in landing, or back to the login form.
   */
  public function claim(string $nonce, Request $request): RedirectResponse {
    $mail = $this->pendingSignup->claim($nonce);
    if ($mail === NULL) {
      // EXPIRED, SPENT OR INVENTED — one answer for all three. A 404 for an
      // unknown nonce and a redirect for an expired one would tell a prober
      // which it held.
      $this->messenger()->addStatus($this->t('Please request a login link first.'));
      return $this->redirect('user.login');
    }

    // FIND BEFORE CREATE. Between the mail and this click the address can
    // have gained an account through the Google door or through a second
    // request that was redeemed first; creating unconditionally would make
    // the one duplicate this product has always refused.
    $account = $this->emailLogin->findOrCreateAccount($mail);
    if ($account === NULL) {
      $this->messenger()->addError($this->t('Your account could not be created. Please try again.'));
      return $this->redirect('user.login');
    }

    // A BLOCKED ACCOUNT GETS NO SESSION, same as the known branch in
    // `EmailLogin::requestLoginLink()`. Within the nonce's lifetime the
    // address can have gained an account that was then blocked — the "found"
    // half of find-before-create considers only existence, not status — so
    // this is checked here rather than assumed impossible. The answer is the
    // SAME neutral one an expired or invented nonce gets, so refusing a
    // blocked account creates no new signal.
    if ($account->isBlocked()) {
      $this->messenger()->addStatus($this->t('Please request a login link first.'));
      return $this->redirect('user.login');
    }

    // The code from the same mail is spent with the link — two halves of
    // one credential, the rule `BbOneTimeLoginController` already applies.
    $this->loginCode->discard($mail);
    user_login_finalize($account);

    return $this->landAfterLogin($request);
  }

}
