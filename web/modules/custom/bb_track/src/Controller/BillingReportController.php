<?php

declare(strict_types=1);

namespace Drupal\bb_track\Controller;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Render\EntityFormSurface;
use Drupal\bb_track\Statistics\BillingReportPage;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The workspace Insights › Billing report page.
 */
final class BillingReportController implements ContainerInjectionInterface {

  /**
   * Constructs the controller.
   */
  public function __construct(private BillingReportPage $page) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('bb_track.billing_report_page'));
  }

  /**
   * Builds the report for the route's workspace.
   *
   * @return array<string, mixed>
   *   The page render array.
   */
  public function page(RouteMatchInterface $route_match, Request $request): array {
    $workspace = $route_match->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface) {
      throw new NotFoundHttpException('No workspace in the current route.');
    }
    return EntityFormSurface::wrap($this->page->build($workspace, $request));
  }

}
