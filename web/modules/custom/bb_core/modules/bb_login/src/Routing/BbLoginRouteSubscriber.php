<?php

declare(strict_types=1);

namespace Drupal\bb_login\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Drupal\bb_login\Controller\BbOneTimeLoginController;
use Drupal\bb_login\Form\BbLoginForm;
use Symfony\Component\Routing\RouteCollection;

/**
 * Mounts the passwordless login form on core's login route, re-lands the link.
 *
 * Core's routes are altered rather than duplicated, because r4032login, the
 * `user.mail` templates and core's own links all point at them:
 * - `user.login` serves the one passwordless form; `user.register` stays a
 *   403 because registration is `admin_only`.
 * - `user.reset.login` is where the mailed link lands, in one hop.
 * - `user.pass` redirects to `user.login`; there is no password surface.
 */
final class BbLoginRouteSubscriber extends RouteSubscriberBase {

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    $route = $collection->get('user.login');
    if ($route !== NULL) {
      // `_entity_form`/`_controller` REMOVED, NOT OVERWRITTEN, so no stale
      // enhancer competes with our `_form` default.
      $defaults = $route->getDefaults();
      unset($defaults['_entity_form'], $defaults['_controller']);
      $defaults['_form'] = BbLoginForm::class;
      $defaults['_title'] = 'Sign in';
      $route->setDefaults($defaults);
    }

    // ONE HOP. The mail addresses `user.reset.login` directly, so
    // `user.reset`'s confirmation screen is never reached and there is
    // nothing to override there: a `?destination` rides on the same request
    // that establishes the session, where core already applies it.
    $reset = $collection->get('user.reset.login');
    if ($reset !== NULL) {
      $reset->setDefault('_controller', BbOneTimeLoginController::class . '::resetPassLogin');
    }

    $pass = $collection->get('user.pass');
    if ($pass !== NULL) {
      $defaults = $pass->getDefaults();
      unset($defaults['_form'], $defaults['_controller'], $defaults['_entity_form']);
      $defaults['_controller'] = BbOneTimeLoginController::class . '::redirectPasswordToLogin';
      $pass->setDefaults($defaults);
    }
  }

}
