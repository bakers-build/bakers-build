<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Url;
use Symfony\Component\HttpFoundation\Request;

/**
 * Removes the query keys htmx transport leaves on a page's URL.
 *
 * A boosted link's GET carries `ajax_page_state[...]` (added by
 * `htmx-assets.js`). Core's form action keeps it, so a full page re-rendered
 * after a validation error, or a redirect repeating it, treats every library
 * as already loaded and arrives without CSS or JavaScript.
 */
final class HtmxTransport {

  /**
   * The query without htmx transport keys.
   *
   * @param array<string, mixed> $query
   *   A request query.
   *
   * @return array<string, mixed>
   *   The query without `ajax_page_state`, `_wrapper_format` and the
   *   triggering element keys.
   */
  public static function strip(array $query): array {
    unset($query['ajax_page_state'], $query['_wrapper_format'], $query['_triggering_element_name'], $query['_triggering_element_value']);
    return $query;
  }

  /**
   * The current page without htmx transport keys, for a form's action.
   */
  public static function currentUrl(Request $request): Url {
    return Url::fromRoute('<current>', [], ['query' => self::strip($request->query->all())]);
  }

}
