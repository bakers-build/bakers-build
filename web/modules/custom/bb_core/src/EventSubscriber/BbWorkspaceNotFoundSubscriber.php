<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\bb_core\Access\BbMachineOwnerAccessCheck;
use Drupal\bb_core\Access\BbRunParentageAccessCheck;
use Drupal\bb_core\Access\BbWorkspaceAccessCheck;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Turns a marked tenancy failure into a 404.
 *
 * The other half of BbWorkspaceAccessCheck and BbMachineOwnerAccessCheck.
 * Those checks cannot throw — they also run when core probes whether to
 * render a link, where an exception aborts the page instead of hiding the
 * link — so they return a forbidden result marked with a reason, and this
 * converts exactly those markers on the way out.
 *
 * The comparison is against the marker, never against "403" in general: a
 * right-workspace/no-permission request is a genuine 403 and stays one. A
 * workspace failure is a 404 because a 403 would confirm that the row exists in
 * some other workspace, which is the fact tenancy withholds.
 *
 * Runs at a high priority so the substitution happens before anything renders,
 * logs or caches a 403 page.
 */
final class BbWorkspaceNotFoundSubscriber implements EventSubscriberInterface {

  /**
   * Replaces a marked access denial with a not-found.
   *
   * @param \Symfony\Component\HttpKernel\Event\ExceptionEvent $event
   *   The exception event.
   */
  public function onException(ExceptionEvent $event): void {
    $exception = $event->getThrowable();
    if (!$exception instanceof AccessDeniedHttpException) {
      return;
    }
    $reasons = [
      BbWorkspaceAccessCheck::WORKSPACE_MISMATCH_REASON,
      BbMachineOwnerAccessCheck::OWNER_MISMATCH_REASON,
      BbRunParentageAccessCheck::PARENTAGE_MISMATCH_REASON,
    ];
    if (!in_array($exception->getMessage(), $reasons, TRUE)) {
      return;
    }
    // No message: the response must say nothing the 403 would have said.
    $event->setThrowable(new NotFoundHttpException('', $exception));
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, array{string, int}>
   *   The subscribed events.
   */
  public static function getSubscribedEvents(): array {
    return [KernelEvents::EXCEPTION => ['onException', 128]];
  }

}
