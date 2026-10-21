<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Entity;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityChangedInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * One version of an addon definition, and the conductors running it.
 */
interface BbAddonInterface extends ContentEntityInterface, EntityChangedInterface {

  /**
   * The workspace this registration belongs to; immutable once set.
   *
   * Derived exclusively from the registering conductor's
   * project → group → workspace ancestry (BB-660/661); never caller-chosen.
   */
  public function workspaceId(): int;

  /**
   * The workspace entity, when it still resolves.
   */
  public function getWorkspace(): ?BbWorkspaceInterface;

  /**
   * The addon name, e.g. `ports`.
   */
  public function name(): string;

  /**
   * The addon version.
   */
  public function version(): string;

  /**
   * The contract version the definition uses.
   */
  public function contract(): int;

  /**
   * The decoded definition.
   *
   * @return array<string, mixed>
   *   The definition.
   */
  public function definition(): array;

  /**
   * The label shown for the addon.
   */
  public function label(): string;

  /**
   * One message type of the definition.
   *
   * @return array<string, mixed>|null
   *   The message definition, NULL when the definition has none of that key.
   */
  public function message(string $key): ?array;

  /**
   * The message a key names, if any.
   *
   * @return array<string, mixed>|null
   *   The capability's definition, NULL when the key names none.
   */
  public function capability(string $key): ?array;

  /**
   * Whether the conductor runs this version.
   */
  public function runsOn(BbConductorInterface $conductor): bool;

  /**
   * Lists the conductor as running this version.
   */
  public function addConductor(BbConductorInterface $conductor): static;

  /**
   * Removes the conductor from this version.
   */
  public function removeConductor(BbConductorInterface $conductor): static;

}
