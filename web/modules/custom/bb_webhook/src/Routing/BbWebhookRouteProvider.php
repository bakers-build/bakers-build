<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\Routing;

use Drupal\bb_webhook\Entity\BbWebhookInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Symfony\Component\Routing\Route;

/**
 * Titles the webhook's edit form, its only page, with its name.
 */
final class BbWebhookRouteProvider extends AdminHtmlRouteProvider {

  /**
   * The webhook's name.
   */
  public static function title(BbWebhookInterface $bb_webhook): string {
    return (string) $bb_webhook->label();
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditFormRoute(EntityTypeInterface $entity_type): ?Route {
    $route = parent::getEditFormRoute($entity_type);
    // Core's editTitle() would title the first entity parameter, the workspace.
    $route?->setDefault('_title_callback', static::class . '::title');
    return $route;
  }

}
