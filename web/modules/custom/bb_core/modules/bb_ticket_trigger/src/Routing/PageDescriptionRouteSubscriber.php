<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Symfony\Component\Routing\RouteCollection;

/**
 * Describes a template's Triggers tab.
 *
 * The page header shows the route default `_description` under the title;
 * a Views display has no setting for it, so it is set here.
 */
final class PageDescriptionRouteSubscriber extends RouteSubscriberBase {

  /**
   * The line under the page title, by route.
   */
  private const DESCRIPTIONS = [
    'view.bb_ticket_triggers.template_list' => 'The triggers that create tickets from this template.',
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
