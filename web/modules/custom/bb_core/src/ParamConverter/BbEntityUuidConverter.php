<?php

declare(strict_types=1);

namespace Drupal\bb_core\ParamConverter;

use Drupal\Component\Uuid\Uuid;
use Drupal\Core\ParamConverter\EntityConverter;
use Symfony\Component\Routing\Route;

/**
 * Upcasts an entity route parameter from either its integer id or its UUID.
 *
 * The default entity converter loads strictly by id, but JSON:API and the
 * CLI address entities by UUID. A UUID is resolved to the id and handed to the
 * parent (bundle, revision and translation handling still apply); any other
 * value goes straight to the parent.
 *
 * It is opt-in only: applies() returns FALSE so it is never auto-selected.
 * Attach it explicitly per route via `options.parameters.<name>.converter`
 * (see BbWorkspaceRouteSubscriber). The generic class lets other bakers.build
 * entities opt in the same way, and BbHumanReferenceConverter extends it so
 * the ticket and project slots keep accepting a UUID.
 */
class BbEntityUuidConverter extends EntityConverter {

  /**
   * {@inheritdoc}
   */
  public function convert($value, $definition, $name, array $defaults) {
    if (is_string($value) && Uuid::isValid($value)) {
      $entity_type_id = $this->getEntityTypeFromDefaults($definition, $name, $defaults);
      $entity = $this->entityRepository->loadEntityByUuid($entity_type_id, $value);
      if ($entity !== NULL) {
        // Resolve to the canonical id and let the parent do the actual load, so
        // bundle filtering / revisions / translation contexts still apply.
        $value = $entity->id();
      }
    }
    return parent::convert($value, $definition, $name, $defaults);
  }

  /**
   * {@inheritdoc}
   */
  public function applies($definition, $name, Route $route) {
    // Opt-in only: attached explicitly by route option, never auto-selected, so
    // it can never hijack another entity type's routes.
    return FALSE;
  }

}
