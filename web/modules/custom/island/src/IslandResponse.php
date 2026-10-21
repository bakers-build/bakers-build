<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Url;

/**
 * The mutation contract of every island interaction.
 *
 * A fluent value object collecting the author's intents; the
 * IslandResponder turns it into one HTML fragment response in the same
 * request (server-computed OOB fan-out).
 */
final class IslandResponse {

  /**
   * Whether the triggering island re-renders as the main fragment.
   */
  private bool $rebuildSelf = FALSE;

  /**
   * Peer island ids to re-render out-of-band.
   *
   * @var string[]
   */
  private array $rebuilds = [];

  /**
   * Server-side events to dispatch, name to payload.
   *
   * @var array<string, array>
   */
  private array $events = [];

  /**
   * Client events for the HX-Trigger header, name to payload.
   *
   * @var array<string, array>
   */
  private array $clientEvents = [];

  /**
   * The HX-Location redirect target, if any.
   */
  private ?Url $location = NULL;

  private function __construct() {}

  /**
   * Starts a new island response.
   */
  public static function make(): static {
    return new static();
  }

  /**
   * Re-renders the triggering island as the main fragment.
   */
  public function rebuildSelf(): static {
    $this->rebuildSelf = TRUE;
    return $this;
  }

  /**
   * Re-renders the given peer islands as out-of-band fragments.
   *
   * @param string[] $ids
   *   Island plugin ids.
   */
  public function rebuild(array $ids): static {
    $this->rebuilds = array_values(array_unique([...$this->rebuilds, ...$ids]));
    return $this;
  }

  /**
   * Dispatches a server-side event to all subscribed peer islands.
   */
  public function dispatch(string $event, array $payload = []): static {
    $this->events[$event] = $payload;
    return $this;
  }

  /**
   * Emits an HX-Trigger client event header (JS side effect only).
   */
  public function triggerClientEvent(string $event, array $payload = []): static {
    $this->clientEvents[$event] = $payload;
    return $this;
  }

  /**
   * Emits an HX-Location header (client redirect after a mutation).
   */
  public function location(Url $url): static {
    $this->location = $url;
    return $this;
  }

  /**
   * Whether the triggering island re-renders as the main fragment.
   */
  public function shouldRebuildSelf(): bool {
    return $this->rebuildSelf;
  }

  /**
   * Peer island ids to re-render out-of-band.
   *
   * @return string[]
   *   Island plugin ids.
   */
  public function getRebuilds(): array {
    return $this->rebuilds;
  }

  /**
   * Server-side events to dispatch.
   *
   * @return array<string, array>
   *   Event name to payload map.
   */
  public function getEvents(): array {
    return $this->events;
  }

  /**
   * Client events for the HX-Trigger header.
   *
   * @return array<string, array>
   *   Event name to payload map.
   */
  public function getClientEvents(): array {
    return $this->clientEvents;
  }

  /**
   * The HX-Location redirect target, if any.
   */
  public function getLocation(): ?Url {
    return $this->location;
  }

}
