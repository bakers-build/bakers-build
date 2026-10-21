<?php

declare(strict_types=1);

namespace Drupal\island;

/**
 * Resolves module-provided app implementations.
 */
final class AppProviderManager {

  /**
   * Collected providers keyed by their configuration id.
   *
   * @var array<string, \Drupal\island\AppProviderInterface>
   */
  private array $providers = [];

  /**
   * Adds a tagged application provider.
   */
  public function addProvider(AppProviderInterface $provider): void {
    $this->providers[$provider->getId()] = $provider;
  }

  /**
   * Resolves a provider, or NULL when the app implementation is unavailable.
   */
  public function get(string $id): ?AppProviderInterface {
    return $this->providers[$id] ?? NULL;
  }

}
