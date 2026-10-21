<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Figure;

/**
 * Immutable atomic payload consumed by every statistics surface.
 */
final readonly class FigureResult {

  /**
   * Constructs an atomic figure result.
   *
   * @param array<string, mixed> $payload
   *   The complete serialized figure payload.
   */
  public function __construct(private array $payload) {}

  /**
   * Serializes the figure result.
   *
   * @return array<string, mixed>
   *   The API payload.
   */
  public function toArray(): array {
    return $this->payload;
  }

}
