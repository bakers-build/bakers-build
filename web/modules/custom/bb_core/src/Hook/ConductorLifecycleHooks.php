<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\Conductor\ConductorReaper;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Conductor lifecycle cron hooks.
 */
final class ConductorLifecycleHooks {

  public function __construct(
    #[Autowire(service: 'bb_core.conductor_reaper')]
    private readonly ConductorReaper $reaper,
  ) {
  }

  /**
   * Implements hook_cron().
   *
   * Flips stale conductors to offline (lease expired). Liveness is derived from
   * status + lease_expires_at, never from deleting the entity — this is the
   * single authority for the offline transition, covering graceful drains, hard
   * kills, and crashes uniformly.
   */
  #[Hook('cron')]
  public function cron(): void {
    $this->reaper->reap();
  }

}
