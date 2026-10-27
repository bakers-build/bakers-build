<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Sends an anonymous visitor of My work › Stats to sign in.
 *
 * Everyone has their own figures there, so a signed-out visitor is asked to
 * sign in and comes back afterwards. Signed-in accounts outside the workspace
 * keep the workspace boundary's 404.
 *
 * Matched by path, not route: an unknown slug never reaches the route and
 * 404s, and answering that differently would reveal which workspaces exist.
 *
 * Runs before BbWorkspaceNotFoundSubscriber, which would turn the denial into
 * a 404 first.
 */
final class MyWorkSignInSubscriber implements EventSubscriberInterface {

  /**
   * The My work › Stats path; the slug part is BbWorkspaceSlugConstraint.
   *
   * Case-insensitive because the path processor lowercases the slug.
   */
  private const PATH = '#^/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?/stats$#i';

  public function __construct(
    private readonly AccountInterface $currentUser,
  ) {}

  /**
   * Replaces an anonymous denial or 404 of `/{slug}/stats` with a sign-in.
   *
   * @param \Symfony\Component\HttpKernel\Event\ExceptionEvent $event
   *   The exception event.
   */
  public function onException(ExceptionEvent $event): void {
    $request = $event->getRequest();
    $exception = $event->getThrowable();
    if (!($exception instanceof AccessDeniedHttpException || $exception instanceof NotFoundHttpException)
      || !$this->currentUser->isAnonymous()
      || !preg_match(self::PATH, $request->getPathInfo())) {
      return;
    }
    $login = Url::fromRoute('user.login', [], ['query' => ['destination' => $request->getRequestUri()]]);
    $event->setResponse(new RedirectResponse($login->toString()));
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, array{string, int}>
   *   The subscribed events.
   */
  public static function getSubscribedEvents(): array {
    return [KernelEvents::EXCEPTION => ['onException', 129]];
  }

}
