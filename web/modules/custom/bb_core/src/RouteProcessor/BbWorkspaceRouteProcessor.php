<?php

declare(strict_types=1);

namespace Drupal\bb_core\RouteProcessor;

use Drupal\Core\Render\BubbleableMetadata;
use Drupal\Core\RouteProcessor\OutboundRouteProcessorInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\bb_core\Entity\BbWorkspace;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Symfony\Component\Routing\Route;

/**
 * Fills the workspace slot from the ambient workspace when a caller omits it.
 *
 * Entity links do not need this — BbContentEntityBase::urlRouteParameters()
 * supplies the slug from the entity itself. What needs it is every product URL
 * built from a route NAME with no entity behind it, and the dashboard is full
 * of them, e.g. the dashboard's htmx fragment routes. Workspace routes are
 * recognised by their `_bb_workspace_match` requirement, so this and the
 * access check agree on the set.
 *
 * A supplied value always wins. An orphan entity (broken chain) or a page
 * outside any workspace falls back to BbWorkspace::DEFAULT_SLUG, so one
 * orphan row cannot abort a listing with MissingMandatoryParametersException;
 * the link still 404s under BbWorkspaceAccessCheck, so nothing is widened.
 */
final class BbWorkspaceRouteProcessor implements OutboundRouteProcessorInterface {

  /**
   * Constructs a BbWorkspaceRouteProcessor.
   *
   * @param \Drupal\Core\Routing\RouteMatchInterface $routeMatch
   *   The current route match, i.e. the workspace the request is already in.
   */
  public function __construct(
    private readonly RouteMatchInterface $routeMatch,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public function processOutbound($route_name, Route $route, array &$parameters, ?BubbleableMetadata $bubbleable_metadata = NULL): void {
    if (isset($parameters['bb_workspace']) || !$route->hasRequirement('_bb_workspace_match')) {
      return;
    }
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    $parameters['bb_workspace'] = $workspace instanceof BbWorkspaceInterface
      ? $workspace->getSlug()
      : BbWorkspace::DEFAULT_SLUG;
    // The generated URL now depends on which route the request matched.
    $bubbleable_metadata?->addCacheContexts(['route']);
  }

}
