<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\bb_core\Plugin\Validation\Constraint\BbWorkspaceSlugConstraint;
use Drupal\Core\ParamConverter\ParamNotConvertedException;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Sends a signed-out visitor of a workspace URL to sign in.
 *
 * The visitor comes back to the same URL afterwards. Signed-in accounts
 * outside the workspace keep the workspace boundary's 404. Only a safe request
 * can return to its URL after sign-in, so a write keeps its 403 or 404.
 *
 * Matched by path, not route: an unknown slug or a missing entity never
 * reaches the route and 404s, while an existing one is denied. Answering both
 * the same way reveals neither which workspaces nor which entities exist.
 *
 * Every workspace route has a segment after the slug, so single-segment paths
 * (`/favicon.ico`) and reserved roots (`/jsonapi`, `/user`) keep their 404.
 *
 * Runs before BbWorkspaceNotFoundSubscriber, which would turn the denial into
 * a 404 first.
 */
final class WorkspaceSignInSubscriber implements EventSubscriberInterface {

  public function __construct(
    private readonly AccountInterface $currentUser,
  ) {}

  /**
   * Replaces an anonymous denial or 404 of `/{slug}/…` with a sign-in.
   *
   * @param \Symfony\Component\HttpKernel\Event\ExceptionEvent $event
   *   The exception event.
   */
  public function onException(ExceptionEvent $event): void {
    $request = $event->getRequest();
    $exception = $event->getThrowable();
    // A missing entity is still unconverted here; core 404s it at priority 75.
    if (!($exception instanceof AccessDeniedHttpException || $exception instanceof NotFoundHttpException || $exception instanceof ParamNotConvertedException)
      || !$request->isMethodSafe()
      || !$this->currentUser->isAnonymous()
      || !self::isWorkspacePath($request->getPathInfo())) {
      return;
    }
    $login = Url::fromRoute('user.login', [], ['query' => ['destination' => $request->getRequestUri()]]);
    $event->setResponse(new RedirectResponse($login->toString()));
  }

  /**
   * Whether a path is `/{slug}/{rest}` with a slug a workspace may claim.
   */
  private static function isWorkspacePath(string $path): bool {
    $parts = explode('/', $path, 3);
    // The path processor lowercases the slug, so match it case-insensitively.
    $slug = strtolower($parts[1] ?? '');
    return ($parts[2] ?? '') !== ''
      && preg_match(BbWorkspaceSlugConstraint::PATTERN, $slug) === 1
      && !in_array($slug, BbWorkspaceSlugConstraint::RESERVED, TRUE);
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
