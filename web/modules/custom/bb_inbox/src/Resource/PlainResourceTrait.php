<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Resource;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\jsonapi\JsonApiResource\LinkCollection;
use Drupal\jsonapi\JsonApiResource\ResourceObject;
use Drupal\jsonapi\JsonApiResource\ResourceObjectData;
use Drupal\jsonapi\ResourceResponse;
use Drupal\jsonapi\ResourceType\ResourceType;
use Drupal\jsonapi\ResourceType\ResourceTypeAttribute;
use Symfony\Component\HttpFoundation\Request;

/**
 * Answers a resource with one non-entity object of plain attributes.
 *
 * Same construction as bb_core's statistics index: a synthetic resource
 * type, one resource object, no caching.
 */
trait PlainResourceTrait {

  /**
   * A synthetic resource type carrying the given attribute names.
   *
   * @param string $name
   *   The type name.
   * @param array<string> $fields
   *   The attribute names.
   */
  protected static function plainResourceType(string $name, array $fields): ResourceType {
    $attributes = [];
    foreach ($fields as $field) {
      $attributes[$field] = new ResourceTypeAttribute($field);
    }
    $type = new ResourceType($name, $name, '', FALSE, FALSE, FALSE, FALSE, $attributes, $name);
    $type->setRelatableResourceTypes([]);
    return $type;
  }

  /**
   * Builds the response for one plain object.
   *
   * @param \Symfony\Component\HttpFoundation\Request $request
   *   The request.
   * @param \Drupal\jsonapi\ResourceType\ResourceType $type
   *   The synthetic resource type.
   * @param string $id
   *   The object id.
   * @param array<string, mixed> $values
   *   The attribute values.
   * @param int $status
   *   The HTTP status.
   */
  protected function plainResponse(Request $request, ResourceType $type, string $id, array $values, int $status = 200): ResourceResponse {
    $cacheability = (new CacheableMetadata())->setCacheMaxAge(0);
    $object = new ResourceObject($cacheability, $type, $id, NULL, $values, new LinkCollection([]));
    return $this->createJsonapiResponse(new ResourceObjectData([$object], 1), $request, $status);
  }

  /**
   * Decodes data.attributes from a JSON:API request body.
   *
   * @return array<string, mixed>
   *   The attributes, empty when absent.
   */
  protected function requestAttributes(Request $request): array {
    $decoded = json_decode($request->getContent(), TRUE);
    return is_array($decoded) && isset($decoded['data']['attributes']) && is_array($decoded['data']['attributes'])
      ? $decoded['data']['attributes']
      : [];
  }

}
