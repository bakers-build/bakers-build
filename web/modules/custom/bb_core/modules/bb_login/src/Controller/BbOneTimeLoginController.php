<?php

declare(strict_types=1);

namespace Drupal\bb_login\Controller;

use Drupal\Core\Messenger\MessengerInterface;
use Drupal\Core\Url;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\bb_login\LoginCode;
use Drupal\bb_login\SignedInLanding;
use Drupal\user\Controller\UserController;
use Drupal\user\UserInterface;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Lands a used one-time login link in the product instead of on the profile.
 *
 * Core redirects a used link to the account edit form to set a password
 * (`UserController.php:273-280`); with no passwords that is the wrong page.
 * Subclassing keeps core's validation, flood clears and single-use token;
 * only a successful login's landing changes, and `?destination` still wins
 * through `RedirectResponseSubscriber`.
 */
final class BbOneTimeLoginController extends UserController {

  use SignedInLanding;

  /**
   * Voids the code from the same mail once the link has been used.
   */
  private LoginCode $loginCode;

  /**
   * {@inheritdoc}
   *
   * EXTENDED RATHER THAN REPLACED. Core's six arguments are passed straight
   * through — they carry the flood clears, the storage and the logger that
   * `resetPassLogin()` relies on — and the seventh is this product's own: the
   * code issued alongside this link, which using the link has to spend.
   */
  public static function create(ContainerInterface $container): static {
    $controller = new static(
      $container->get('date.formatter'),
      $container->get('entity_type.manager')->getStorage('user'),
      $container->get('user.data'),
      $container->get('logger.factory')->get('user'),
      $container->get('flood'),
      $container->get('datetime.time'),
    );
    $controller->loginCode = $container->get('bb_login.login_code');
    return $controller;
  }

  /**
   * The session key a pending post-login destination is parked under.
   *
   * ONE KEY, TWO WRITERS, ONE READER. `BbLoginForm` writes it when the login
   * form is submitted from a page that carried `?destination` (the same-browser
   * case, which is the ordinary one: a deep link bounces through r4032login,
   * the visitor types their address, and the mail is opened on that machine).
   * `::resetPass()` below writes it when the MAILED URL carries the parameter,
   * which is what makes the link work when it is opened on a phone instead.
   * `::resetPassLogin()` is the only reader and it consumes the key.
   */
  public const DESTINATION_KEY = 'bb_login.destination';

  /**
   * Sends leftover password-form requests to the one login door.
   */
  public function redirectPasswordToLogin(): RedirectResponse {
    return new RedirectResponse(Url::fromRoute('user.login')->toString());
  }

  /**
   * {@inheritdoc}
   */
  public function resetPassLogin($uid, $timestamp, $hash, Request $request) {
    // SNAPSHOTTED RATHER THAN STRING-MATCHED. `parent::` adds the status
    // message *"You have used a one-time login link. You can set your new
    // password now."* (`UserController.php:266`), which promises a password
    // this product does not have. Restoring the queue to what it
    // held BEFORE the call removes exactly what the call added, whatever that
    // sentence happens to say in the next core release; comparing text would
    // silently stop working when core rewords it.
    //
    // ERRORS ARE NOT TOUCHED. Only the status queue is restored, so the
    // "link expired" and "already used" refusals `determineErrorRedirect()`
    // adds still reach the visitor.
    $status_before = $this->messenger()->messagesByType(MessengerInterface::TYPE_STATUS);

    $response = parent::resetPassLogin($uid, $timestamp, $hash, $request);

    $this->messenger()->deleteByType(MessengerInterface::TYPE_STATUS);
    foreach ($status_before as $message) {
      $this->messenger()->addStatus($message);
    }

    // THE CODE FROM THE SAME MAIL IS VOID ONCE THE LINK IS USED. They are two
    // halves of one credential, so spending either has to end the other —
    // otherwise a mail read twice hands out two sessions.
    if ($this->currentUser()->isAuthenticated()) {
      $account = $this->entityTypeManager()->getStorage('user')->load($this->currentUser()->id());
      if ($account instanceof UserInterface) {
        $this->loginCode->discard((string) $account->getEmail());
      }
    }

    // ASKED OF THE SESSION, NOT OF THE RESPONSE. `parent::` returns a redirect
    // in both outcomes — to the edit form when the login succeeded, and to
    // `user.pass` when the link was invalid or expired — and inspecting the
    // target URL to tell them apart would couple this class to core's choice of
    // failure route. Whether a session now exists is the actual question, and
    // it has exactly one answer.
    if (!$this->currentUser()->isAuthenticated()) {
      return $response;
    }

    // THE ONE LANDING TAIL, shared with `BbSignupClaimController`.
    return $this->landAfterLogin($request);
  }

}
