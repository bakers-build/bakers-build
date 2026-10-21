<?php

declare(strict_types=1);

namespace Drupal\bb_core\JsonApi;

use Drupal\jsonapi\ResourceType\ResourceType;

/**
 * A resource type that reports its collection total in meta.count.
 *
 * Core writes meta.count already; it is gated on includeCount(), which
 * ResourceType hardcodes to FALSE "so we can allow polymorphic
 * implementations". This is that implementation. There is no hook: the resource
 * type build event can rename and disable, not set this flag.
 *
 * The number is trustworthy because the count query IS the collection query
 * with its range cleared, so the query_access handlers filter both alike.
 */
final class BbResourceType extends ResourceType {

  /**
   * {@inheritdoc}
   */
  public function includeCount() {
    return TRUE;
  }

}
