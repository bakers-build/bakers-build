<?php

declare(strict_types=1);

namespace Drupal\bb_core\Derive;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Time\BbDate;

/**
 * Derives dashboard display values for a conductor.
 *
 * Liveness and states come from the conductor; utilization load/max come from
 * the linked bb_machine. Results are not cached because conductor
 * rows are re-evaluated on each request.
 */
final class ConductorDeriver {

  /**
   * Stale threshold in seconds (10 minutes).
   */
  private const STALE_THRESHOLD = 600;

  public function __construct(
    private readonly TimeInterface $time,
    private readonly BbDate $date,
  ) {
  }

  /**
   * Derived node liveness status for the dashboard.
   *
   * Logic:
   *  - last_seen <= now - 600 s (including never reported, last_seen == 0)
   *                               → 'stale'
   *  - status == 'offline'       → 'offline'
   *  - otherwise (online)        → 'online'
   *
   * A record that never reported (last_seen == 0) is deliberately 'stale';
   * registration does not stamp last_seen, so a failed registration shows.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor entity.
   *
   * @return string
   *   One of 'online', 'stale', or 'offline'.
   */
  public function nodeStatus(BbConductorInterface $conductor): string {
    $lastSeen = (int) ($conductor->get('last_seen')->value ?? 0);
    if ($lastSeen <= ($this->time->getRequestTime() - self::STALE_THRESHOLD)) {
      return 'stale';
    }
    return $conductor->getStatus() === 'offline' ? 'offline' : 'online';
  }

  /**
   * Label of the conductor's optional served-states filter.
   *
   * The `states` list is an optional narrowing: an empty or absent
   * list means the conductor serves every claimable state in its project.
   * Render that case as "all claimable states" rather than a blank cell that
   * reads as "none".
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor entity.
   *
   * @return string
   *   The listed states joined with ', ', or "all claimable states" when the
   *   optional filter is empty.
   */
  public function nodeStatesLabel(BbConductorInterface $conductor): string {
    $states = $conductor->getStates();
    return $states === [] ? 'all claimable states' : implode(', ', $states);
  }

  /**
   * Load label showing current/max parallel runs.
   *
   * A conductor without a linked machine has no known capacity; the label says
   * so rather than inventing a number.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor entity.
   *
   * @return string
   *   E.g. "2 / 4 parallel runs", or "Unknown capacity" without a machine.
   */
  public function nodeLoadLabel(BbConductorInterface $conductor): string {
    $capacity = $this->nodeCapacity($conductor);
    return (string) ($capacity === NULL
      ? new TranslatableMarkup('Unknown capacity')
      : new TranslatableMarkup('@current / @max parallel runs', ['@current' => $capacity[0], '@max' => $capacity[1]]));
  }

  /**
   * Utilization level of the conductor's current load against its capacity.
   *
   * A machine-readable companion to nodeLoadLabel(): the label says how much,
   * this says how much *relative to capacity*, so a listing can mark a
   * conductor at capacity as such without the reader doing the arithmetic.
   *
   * The mapping is total and division-free, which settles the degenerate pairs
   * deliberately rather than by accident:
   *  - no linked machine        → 'unknown'
   *  - load <= 0                → 'idle'   (covers 0/0)
   *  - max > 0 && load >= max   → 'full'   (covers over-capacity, e.g. 4/3)
   *  - otherwise                → 'partial' (covers max <= 0 with a load)
   *
   * Over-capacity is a self-reported inconsistency, not an error state, so it
   * reads 'full' rather than a fourth level nothing consumes.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor entity.
   *
   * @return string
   *   One of 'unknown', 'idle', 'partial', or 'full'.
   */
  public function nodeLoadLevel(BbConductorInterface $conductor): string {
    $capacity = $this->nodeCapacity($conductor);
    if ($capacity === NULL) {
      return 'unknown';
    }
    [$current, $max] = $capacity;
    if ($current <= 0) {
      return 'idle';
    }
    return ($max > 0 && $current >= $max) ? 'full' : 'partial';
  }

  /**
   * Host capacity from the linked machine.
   *
   * @return array{0: int, 1: int}|null
   *   current_load, max_parallel; NULL when no machine is linked.
   */
  public function nodeCapacity(BbConductorInterface $conductor): ?array {
    $machine = $conductor->getMachine();
    return $machine === NULL ? NULL : [$machine->getCurrentLoad(), $machine->getMaxParallel()];
  }

  /**
   * Humanised age of the last_seen timestamp.
   *
   * Always returns a plain string — never TranslatableMarkup — to avoid
   * TypeError when serialised (e.g. in JSON:API responses or computed fields).
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor entity.
   *
   * @return string
   *   A relative age such as "12 sec ago", or "Never" when last_seen is unset.
   */
  public function lastSeenLabel(BbConductorInterface $conductor): string {
    $lastSeen = (int) ($conductor->get('last_seen')->value ?? 0);
    if ($lastSeen <= 0) {
      return 'Never';
    }
    return $this->date->label($lastSeen);
  }

}
