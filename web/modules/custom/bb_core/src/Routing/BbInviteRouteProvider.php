<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Symfony\Component\Routing\Route;

/**
 * Titles the invitation's detail page.
 */
final class BbInviteRouteProvider extends AdminHtmlRouteProvider {

  /**
   * The line under the page title, by route.
   */
  private const DESCRIPTIONS = [
    'entity.bb_invite.canonical' => 'This invitation to join the workspace.',
    'entity.bb_invite.delete_form' => 'Confirm the deletion of this invitation.',
  ];

  /**
   * {@inheritdoc}
   */
  public function getRoutes(EntityTypeInterface $entity_type) {
    $collection = parent::getRoutes($entity_type);
    foreach (self::DESCRIPTIONS as $name => $description) {
      $collection->get($name)?->setDefault('_description', $description);
    }
    return $collection;
  }

  /**
   * {@inheritdoc}
   *
   * A static title: core's `title()` would title the route's first entity
   * parameter, the workspace.
   */
  protected function getCanonicalRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getCanonicalRoute($entity_type);
    $route?->setDefault('_title', 'Invitation');
    $route?->setDefaults(array_diff_key($route->getDefaults(), ['_title_callback' => TRUE]));
    return $route;
  }

}
