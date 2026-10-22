<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Routing\LocalRedirectResponse;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\bb_core\Onboarding\OnboardingDestination;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Sends incomplete interactive HTML entry to the onboarding wizard.
 *
 * The decision is `OnboardingDestination::isComplete()` — the stored Boolean —
 * not optional profile fullness or workspace membership. JSON:API, OAuth,
 * bakers.build's own `/_bakers-api`, logout, the wizard itself, Drupal's AJAX
 * endpoints and static assets stay reachable so the guard cannot loop or
 * intercept non-browser work.
 *
 * Responses are uncacheable (max-age 0) so one account's redirect cannot be
 * stored and served to another.
 */
final class OnboardingGuardSubscriber implements EventSubscriberInterface {

  /**
   * Routes that must remain reachable while onboarding is incomplete.
   */
  private const EXEMPT_ROUTES = [
    'bb_core.onboarding',
    'user.login',
    'user.logout',
    'user.logout.confirm',
    'user.pass',
    'user.pass.http',
    'user.register',
    'user.reset',
    'user.reset.form',
    'user.reset.login',
    'user.check_mail',
    'system.csrftoken',
    'system.ajax',
    'system.404',
    'system.403',
    'system.cron',
    'file.ajax_progress',
    'bb_core.run_log_download_api',
  ];

  /**
   * Route-name prefixes that are never application HTML screens.
   */
  private const EXEMPT_ROUTE_PREFIXES = [
    'jsonapi.',
    'oauth2_',
    'simple_oauth.',
    'social_auth.',
    'social_api.',
    'bb_login.',
    'image.style_',
    'rest.',
    'system.css_',
    'system.js_',
  ];

  public function __construct(
    private readonly AccountProxyInterface $currentUser,
    private readonly OnboardingDestination $destination,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    // Below AuthenticationSubscriber's filter (31) and the router (32), so
    // both the account and `_route` are set; above the controller.
    return [KernelEvents::REQUEST => ['onRequest', 30]];
  }

  /**
   * Redirects an incomplete interactive HTML request to the wizard.
   */
  public function onRequest(RequestEvent $event): void {
    if (!$event->isMainRequest()) {
      return;
    }
    if ($this->currentUser->isAnonymous()) {
      return;
    }
    $request = $event->getRequest();
    if ($this->isExempt($request)) {
      return;
    }
    if ($this->destination->isComplete($this->currentUser)) {
      return;
    }

    $response = new LocalRedirectResponse($this->destination->wizardUrl()->toString());
    $response->addCacheableDependency(
      (new CacheableMetadata())
        ->setCacheMaxAge(0)
        ->setCacheContexts(['user', 'url.path', 'headers:HX-Request']),
    );
    $event->setResponse($response);
  }

  /**
   * Whether this request is outside the interactive application guard.
   */
  private function isExempt(Request $request): bool {
    $route = (string) $request->attributes->get('_route', '');
    if (in_array($route, self::EXEMPT_ROUTES, TRUE)) {
      return TRUE;
    }
    foreach (self::EXEMPT_ROUTE_PREFIXES as $prefix) {
      if (str_starts_with($route, $prefix)) {
        return TRUE;
      }
    }

    $path = $request->getPathInfo();
    // Path prefixes for API requests whose route is not resolved yet or
    // varies per resource; the conductor fetches `/_bakers-api` without an
    // Accept header, so the HTML check below would not exempt it.
    foreach (['/jsonapi', '/oauth', '/_bakers-api'] as $prefix) {
      if ($path === $prefix || str_starts_with($path, $prefix . '/')) {
        return TRUE;
      }
    }

    $accept = (string) $request->headers->get('Accept', '');
    $wantsHtml = str_contains($accept, 'text/html') || $accept === '' || $accept === '*/*';
    if (!$wantsHtml) {
      return TRUE;
    }
    $format = $request->getRequestFormat();
    return !in_array($format, ['html', 'htm'], TRUE);
  }

}
