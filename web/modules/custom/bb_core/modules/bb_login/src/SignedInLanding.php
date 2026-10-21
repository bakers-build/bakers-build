<?php

declare(strict_types=1);

namespace Drupal\bb_login;

use Drupal\bb_login\Controller\BbOneTimeLoginController;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * The one landing tail every completed sign-in runs.
 *
 * Shared by `BbOneTimeLoginController` and `BbSignupClaimController` so
 * both land the same way: a parked deep link, else `bb_core.home`.
 */
trait SignedInLanding {

  /**
   * Lands a just-authenticated session where a completed login always lands.
   *
   * A PENDING DESTINATION IS HANDED BACK TO CORE RATHER THAN APPLIED HERE.
   * Putting it on the request lets `RedirectResponseSubscriber` do what it
   * already does for every other form: override the redirect below AND
   * validate the target. That validation is the reason this is not a
   * `new RedirectResponse($destination)` — the subscriber refuses an
   * external URL, and re-implementing that check would be a second, weaker
   * copy of an open-redirect guard.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The current request, whose session carries any parked destination.
   *
   * @return \Symfony\Component\HttpFoundation\RedirectResponse
   *   The landing redirect.
   */
  protected function landAfterLogin(Request $request): RedirectResponse {
    $session = $request->getSession();
    $destination = (string) $session->get(BbOneTimeLoginController::DESTINATION_KEY, '');
    if ($destination !== '') {
      // CONSUMED, not left standing: a destination that outlived its login
      // would hijack the NEXT sign-in from this browser.
      $session->remove(BbOneTimeLoginController::DESTINATION_KEY);
      $request->query->set('destination', $destination);
    }

    // `bb_core.home` AND NOT `<front>`: after signing in you
    // SEE the workspace overview, which is what `/` would throw a
    // single-workspace operator straight past.
    return $this->redirect('bb_core.home');
  }

}
