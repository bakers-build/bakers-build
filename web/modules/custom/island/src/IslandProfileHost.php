<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;
use Drupal\island\Entity\IslandProfileInterface;

/**
 * Adapts a persisted profile to the standalone island host contract.
 */
final class IslandProfileHost implements IslandContextProviderInterface, IslandViewAccessInterface {

  public function __construct(
    private readonly App $app,
    private readonly IslandProfile $profile,
    private readonly AppProviderInterface $provider,
    private readonly string $instanceId,
    private readonly IslandConditionEvaluator $evaluator,
    private readonly ?IslandProfileEmbedding $embedding = NULL,
  ) {
  }

  /**
   * Referencing placement ids keyed by embedded id, computed once.
   *
   * @var array<string, string[]>|null
   */
  private ?array $references = NULL;

  /**
   * {@inheritdoc}
   */
  public function hostId(): string {
    return IslandRuntimeId::forHost((string) $this->app->id(), (string) $this->profile->id(), $this->instanceId);
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(): array {
    return array_keys($this->profile->getEnabledPlacements());
  }

  /**
   * Returns the plugin type stored by a profile placement.
   */
  public function getIslandPluginId(string $placement_id): string {
    return (string) ($this->profile->getPlacement($placement_id)['plugin_id'] ?? '');
  }

  /**
   * Returns configured app events for a placement.
   *
   * An empty list means the placement relies on the plugin's own event
   * subscription declaration. A non-empty list is an explicit allow-list.
   *
   * @return string[]
   *   Event names.
   */
  public function getPlacementEvents(string $placement_id): array {
    $events = $this->profile->getPlacement($placement_id)['events'] ?? [];
    return array_values(array_filter(array_map('strval', (array) $events)));
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandConfiguration(string $island_id): array {
    return $this->provider->getIslandConfiguration($this->app, $this->profile, $island_id);
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandData(string $island_id): array {
    return $this->provider->getIslandData($this->app, $this->profile, $island_id, $this->instanceId);
  }

  /**
   * {@inheritdoc}
   */
  public function accessIsland(string $island_id, AccountInterface $account): AccessResultInterface {
    // Visibility never grants: it narrows whatever the provider decides, so a
    // refresh or action cannot reach a placement the page would not render.
    $access = $this->placementVisibility($island_id)
      ->andIf($this->provider->accessIsland($this->app, $this->profile, $island_id, $this->instanceId));
    if (($this->profile->getPlacement($island_id)['slot'] ?? '') !== IslandProfileInterface::EMBEDDED_SLOT) {
      return $access;
    }
    // An embedded island is shown only inside its referencing placement.
    $this->references ??= $this->embedding?->references($this->profile) ?? [];
    $referencing = $this->references[$island_id] ?? [];
    $access = $access->andIf(AccessResult::allowedIf($referencing !== []));
    foreach ($referencing as $placement_id) {
      $access = $access->andIf($this->placementVisibility($placement_id));
    }
    return $access;
  }

  /**
   * Evaluates the conditions stored on one placement.
   */
  public function placementVisibility(string $placement_id): AccessResultInterface {
    $placement = $this->profile->getPlacement($placement_id);
    return $this->evaluator->evaluate($placement['conditions'], $placement['condition_operator']);
  }

  /**
   * The application owning this runtime host.
   */
  public function getApp(): App {
    return $this->app;
  }

  /**
   * The profile rendered by this host.
   */
  public function getProfile(): IslandProfile {
    return $this->profile;
  }

  /**
   * The instance scope used for runtime identities.
   */
  public function getInstanceId(): string {
    return $this->instanceId;
  }

}
