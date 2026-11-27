<?php

declare(strict_types=1);

namespace Drupal\bb_board\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Symfony\Component\Routing\RouteCollection;

/**
 * Describes the project Board.
 *
 * The page header shows the route default `_description` under the title;
 * a Views display has no setting for it, so it is set here.
 */
final class PageDescriptionRouteSubscriber extends RouteSubscriberBase {

  /**
   * The line under the page title, by route.
   */
  private const DESCRIPTIONS = [
    'view.project_board.project_board' => 'The tickets of this project, in one column per state.',
  ];

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    foreach (self::DESCRIPTIONS as $name => $description) {
      $collection->get($name)?->setDefault('_description', $description);
    }
  }

}
