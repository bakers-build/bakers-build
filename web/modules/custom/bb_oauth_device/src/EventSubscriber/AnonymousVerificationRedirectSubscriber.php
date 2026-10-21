<?php

declare(strict_types=1);

namespace Drupal\bb_oauth_device\EventSubscriber;

use Drupal\Core\EventSubscriber\HttpExceptionSubscriberBase;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;

/**
 * Sends anonymous visitors of the device page to the login form.
 *
 * The r4032login module leaves every `/oauth/*` path alone so machine
 * endpoints keep their own errors; this is the one human page there.
 */
final class AnonymousVerificationRedirectSubscriber extends HttpExceptionSubscriberBase {

  public function __construct(
    private readonly AccountInterface $currentUser,
  ) {}

  /**
   * {@inheritdoc}
   */
  protected function getHandledFormats(): array {
    return ['html'];
  }

  /**
   * {@inheritdoc}
   */
  protected static function getPriority(): int {
    // Ahead of r4032login and core's HTML 403 page.
    return 10;
  }

  /**
   * Redirects an anonymous 403 on the verification route to the login form.
   */
  public function on403(ExceptionEvent $event): void {
    $request = $event->getRequest();
    if (!$this->currentUser->isAnonymous() || $request->attributes->get('_route') !== 'bb_oauth_device.verify') {
      return;
    }
    // Core's RedirectResponseSubscriber would otherwise follow it instead.
    $request->query->remove('destination');
    $destination = Url::fromRoute('bb_oauth_device.verify', [], ['query' => $request->query->all()])->toString();
    $url = Url::fromRoute('user.login', [], ['query' => ['destination' => $destination]]);
    // Not cacheable: the page cache must not hand one code to another visitor.
    $event->setResponse(new RedirectResponse($url->toString()));
  }

}
