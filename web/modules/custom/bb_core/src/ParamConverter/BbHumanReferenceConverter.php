<?php

declare(strict_types=1);

namespace Drupal\bb_core\ParamConverter;

use Symfony\Component\Routing\Route;

/**
 * Upcasts an entity slot from a human reference, a UUID or an entity id.
 *
 * The path carries the lowercase form of the ticket identifier or project
 * key; the lookup normalises with strtoupper() and matches exactly rather than
 * relying on a case-insensitive collation PostgreSQL lacks.
 *
 * The parent's UUID and id forms stay, because JSON:API and the CLI hand out
 * UUIDs. A human reference is never a UUID or an integer, so trying it first
 * cannot mis-resolve.
 *
 * Opt-in only, like the parent: attached per route by
 * BbWorkspaceRouteSubscriber, never auto-selected.
 */
abstract class BbHumanReferenceConverter extends BbEntityUuidConverter {

  /**
   * The entity type whose rows this converter looks up.
   *
   * @return string
   *   The entity type id.
   */
  abstract protected function entityTypeId(): string;

  /**
   * The field carrying the human reference.
   *
   * @return string
   *   The base field name.
   */
  abstract protected function referenceField(): string;

  /**
   * {@inheritdoc}
   */
  public function convert($value, $definition, $name, array $defaults) {
    $id = $this->resolveReference($value);
    return parent::convert($id ?? $value, $definition, $name, $defaults);
  }

  /**
   * {@inheritdoc}
   */
  public function applies($definition, $name, Route $route) {
    // Opt-in only — see BbEntityUuidConverter::applies().
    return FALSE;
  }

  /**
   * Resolves a path segment to an entity id via the human reference.
   *
   * @param mixed $value
   *   The raw path segment.
   *
   * @return string|null
   *   The entity id, or NULL when the segment is not a human reference or
   *   matches no row — in which case the parent's id/UUID load decides.
   *   Entity queries return their ids as strings, so this never yields an int.
   */
  private function resolveReference(mixed $value): ?string {
    if (!is_string($value) || $value === '' || ctype_digit($value)) {
      return NULL;
    }
    $storage = $this->entityTypeManager->getStorage($this->entityTypeId());
    // accessCheck(FALSE): the route's _entity_access and _bb_workspace_match
    // requirements decide visibility. A narrowed lookup here would turn a
    // permission problem into "no such ticket" with no way to tell them apart.
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition($this->referenceField(), mb_strtoupper($value))
      ->range(0, 1)
      ->execute();
    return $ids === [] ? NULL : (string) reset($ids);
  }

}
