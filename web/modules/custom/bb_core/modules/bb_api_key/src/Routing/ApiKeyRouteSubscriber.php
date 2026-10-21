<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Drupal\bb_api_key\Access\ApiKeyAccess;
use Symfony\Component\Routing\RouteCollection;

/**
 * Normalizes the Views-owned list pages and protects them with owner access.
 *
 * Mirrors bb_track's TimeRouteSubscriber: Views supplies the route for
 * `view.bb_api_keys.page`, this subscriber upgrades its `%user` path
 * parameter to an entity parameter and attaches the owner-only access check,
 * so a direct request is refused before the view ever queries. The Service
 * Accounts listing's own access comes from `BbWorkspaceRouteSubscriber`'s
 * blanket `/settings/*` → `bb_workspace.update` gate (no second access
 * plugin needed for that); this subscriber still has to add its
 * cookie-only restriction, the same as every other Service Accounts route,
 * so a bearer key cannot even reach the list.
 */
final class ApiKeyRouteSubscriber extends RouteSubscriberBase {

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    $list = $collection->get('view.bb_api_keys.page');
    if ($list !== NULL) {
      $parameters = $list->getOption('parameters') ?? [];
      $parameters['user'] = ['type' => 'entity:user'];
      $list->setOption('parameters', $parameters);
      $list->setRequirement('_custom_access', ApiKeyAccess::class . '::keyList');
      $list->setRequirement('user', '\d+');
      // A bearer key must not be able to list or manage keys with the leaked
      // key itself; the owner-only area is reached with a cookie session.
      $list->setOption('_auth', ['cookie']);
    }

    $serviceAccounts = $collection->get('view.bb_service_accounts.settings');
    if ($serviceAccounts !== NULL) {
      $serviceAccounts->setOption('_auth', ['cookie']);
    }
  }

}
