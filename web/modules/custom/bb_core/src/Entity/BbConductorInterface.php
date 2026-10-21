<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Session\AccountInterface;

/**
 * Defines the interface for bakers.build conductor entities.
 *
 * A conductor is an agent registration that can claim and execute bakers.build tickets.
 * Each conductor has a unique conductor_id registration key, a lifecycle
 * status, and one or more states that determine which tickets it may run.
 * Concurrent-run capacity is owned by the linked bb_machine.
 */
interface BbConductorInterface extends BbContentEntityInterface {

  /**
   * Returns the unique conductor registration key.
   */
  public function getConductorId(): string;

  /**
   * Sets the unique conductor registration key.
   */
  public function setConductorId(string $conductor_id): static;

  /**
   * Returns the current lifecycle status of this conductor.
   *
   * @return string
   *   One of 'online' or 'offline'.
   */
  public function getStatus(): string;

  /**
   * Sets the lifecycle status of this conductor.
   *
   * @param string $status
   *   One of 'online' or 'offline'.
   *
   * @return static
   */
  public function setStatus(string $status): static;

  /**
   * Returns the workflow states this conductor is registered to handle.
   *
   * @return string[]
   *   An indexed array of state machine names.
   */
  public function getStates(): array;

  /**
   * Returns the host machine this conductor runs on, if linked.
   */
  public function getMachine(): ?BbMachineInterface;

  /**
   * Whether the given account is this conductor's owning user.
   *
   * An owner of 0 (anonymous) means "no owner", never the anonymous account.
   */
  public function isOwnedBy(AccountInterface $account): bool;

}
