<?php

declare(strict_types=1);

namespace Drupal\island\Entity;

use Drupal\Core\Config\Entity\ConfigEntityInterface;

/**
 * Defines a persisted island profile.
 */
interface IslandProfileInterface extends ConfigEntityInterface {

  /**
   * Returns the owning app id.
   */
  public function getAppId(): string;

  /**
   * Returns the condition plugin configurations that select this profile.
   *
   * @return array<string, array<string, mixed>>
   *   Condition plugin configurations keyed by instance id.
   */
  public function getConditions(): array;

  /**
   * Returns how the profile conditions combine: 'and' or 'or'.
   */
  public function getConditionOperator(): string;

  /**
   * Returns the selected layout component id.
   */
  public function getLayoutId(): string;

  /**
   * Returns the persisted props passed to the layout SDC.
   *
   * @return array<string, mixed>
   *   Layout props.
   */
  public function getLayoutSettings(): array;

  /**
   * Returns one placement without changing its persisted identity.
   *
   * @return array<string, mixed>
   *   Placement configuration.
   */
  public function getPlacement(string $placement_id): array;

  /**
   * Returns enabled placements keyed by stable placement id.
   *
   * @return array<string, array<string, mixed>>
   *   Enabled placement configuration.
   */
  public function getEnabledPlacements(): array;

  /**
   * Returns placements that cannot be assigned to the supplied layout slots.
   *
   * @param array<string, array<string, mixed>> $slots
   *   Valid layout slot definitions.
   *
   * @return array<string, array<string, mixed>>
   *   Unassigned placements keyed by stable placement id.
   */
  public function getUnassignedPlacements(array $slots): array;

  /**
   * Returns placements grouped by slot and ordered deterministically.
   *
   * @return array<string, array<string, array<string, mixed>>>
   *   Slot to placement map.
   */
  public function getPlacementsBySlot(): array;

}
