<?php

declare(strict_types=1);

namespace Drupal\bb_core\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Symfony\Component\Routing\RouteCollection;

/**
 * Adds machine-auth methods (basic_auth, oauth2) to jsonapi_schema routes.
 *
 * The jsonapi_schema module registers its /jsonapi/…/schema routes with
 * `_access: TRUE` but WITHOUT an explicit `_auth` option, so only the global
 * authentication providers (cookie) are allowed. A request authenticated via a
 * non-global provider (basic_auth, oauth2 bearer) is therefore rejected with a
 * 403 "authentication method not allowed on this route" — even though the route
 * grants access to everyone, including anonymous.
 *
 * bakers.build agents authenticate via OAuth2 bearer tokens (dropsh sends the token on
 * EVERY request, including the authoritative-schema fetch), so without this
 * patch dropsh's schema fetch 403s and silently falls back to the heuristic
 * schema. This subscriber patches every jsonapi_schema.* route to allow the
 * machine-auth providers, so authenticated agents receive the schema.
 */
final class JsonApiSchemaRouteSubscriber extends RouteSubscriberBase {

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection): void {
    foreach ($collection->all() as $name => $route) {
      if (!str_starts_with($name, 'jsonapi_schema.')) {
        continue;
      }
      $options = $route->getOptions();
      $existing = (array) ($options['_auth'] ?? []);
      $merged = array_values(array_unique([...$existing, 'basic_auth', 'oauth2', 'cookie']));
      $route->setOption('_auth', $merged);
    }
  }

}
