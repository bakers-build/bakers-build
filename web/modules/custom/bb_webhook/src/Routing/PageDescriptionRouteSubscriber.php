<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Symfony\Component\Routing\RouteCollection;

/**
 * Describes the Webhooks listings.
 *
 * The page header shows the route default `_description` under the title;
 * a Views display has no setting for it, so it is set here.
 */
final class PageDescriptionRouteSubscriber extends RouteSubscriberBase {

  /**
   * The line under the page title, by route.
   */
  private const DESCRIPTIONS = [
    'view.bb_webhooks.workspace_list' => 'The webhooks of this workspace.',
    'view.bb_webhooks.project_list' => 'The webhooks of this project.',
    'view.bb_webhooks.group_list' => 'The webhooks of this group.',
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
