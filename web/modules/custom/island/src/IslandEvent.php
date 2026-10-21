<?php

declare(strict_types=1);

namespace Drupal\island;

/**
 * Server-side island event (dispatched via IslandResponse::dispatch()).
 */
final class IslandEvent {

  public function __construct(
    public readonly string $name,
    public readonly array $payload,
    public readonly string $sourceIslandId,
    public readonly string $hostId,
  ) {}

}
