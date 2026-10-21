<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * A former product Settings URL: its fields are edited on the detail cards.
 *
 * A visit lands on the detail page; a stale POST is refused rather than
 * saved, so no second editing surface survives.
 */
final class RetiredEditSurfaceController {

  /**
   * Redirects to the canonical detail, or refuses a write.
   */
  public function redirect(Request $request, RouteMatchInterface $route_match, string $entity_type_id): RedirectResponse {
    if (!$request->isMethodSafe()) {
      throw new MethodNotAllowedHttpException(['GET', 'HEAD'], 'This form moved to the detail page cards.');
    }
    $entity = $route_match->getParameter($entity_type_id);
    if (!$entity instanceof EntityInterface) {
      throw new NotFoundHttpException();
    }
    return new RedirectResponse($entity->toUrl()->setAbsolute()->toString());
  }

}
