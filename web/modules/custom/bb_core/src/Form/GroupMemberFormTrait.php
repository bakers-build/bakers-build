<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormStateInterface;

/**
 * The group an island member form is acting on, and how to name it.
 *
 * The group comes from the island host under the key `group`, never from a
 * route parameter, whose name would carry the entity type. This file names no
 * entity type (GroupMemberSurfaceTest reads it); the noun is derived from the
 * entity type rather than switched on.
 */
trait GroupMemberFormTrait {

  /**
   * The group this island is rendering, from its host's data.
   *
   * A CONTENT entity specifically, and not merely an EntityInterface: OG
   * membership is a relationship between two content entities, so
   * `OgMembership::setGroup()` takes nothing weaker. Narrowing here rather than
   * casting at each call site keeps the promise in one place.
   *
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state carrying the island build-info args.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface|null
   *   The group, or NULL off a group route.
   */
  private function group(FormStateInterface $form_state): ?ContentEntityInterface {
    [$island, $host] = $this->resolveIsland($form_state);
    // The placement id (`members`), not the generic `configured_form` plugin
    // id, as `IslandResponder` resolves it for a rebuild.
    $island_id = method_exists($island, 'getRuntimeIslandId')
      ? $island->getRuntimeIslandId()
      : $island->getPluginId();
    $group = $host->getIslandData($island_id)['group'] ?? NULL;

    return $group instanceof ContentEntityInterface ? $group : NULL;
  }

  /**
   * The human noun for a group, for a message or an accessible name.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The group.
   *
   * @return string
   *   The entity type's own singular label.
   */
  private function groupNoun(ContentEntityInterface $group): string {
    return (string) $group->getEntityType()->getSingularLabel();
  }

}
