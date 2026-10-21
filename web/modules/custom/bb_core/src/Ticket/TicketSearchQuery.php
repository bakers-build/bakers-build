<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

/**
 * What one typed search line turned out to mean.
 *
 * Exactly one of `field`, `fulltext` and `error` is set, or none of them when
 * the line was empty and the search constrains nothing.
 */
final class TicketSearchQuery {

  /**
   * Holds what the line resolved to.
   *
   * @param string|null $field
   *   The index field to compare exactly: `identifier` or `origin_ref`.
   * @param string|list<string>|null $value
   *   The value compared with `=`, or a list compared with `IN`.
   * @param string|null $fulltext
   *   The free-text query, when the line was not a reference.
   * @param string|null $error
   *   The message for an ambiguous or unknown reference.
   * @param string[] $candidates
   *   The repository aliases the message names.
   */
  public function __construct(
    public readonly ?string $field = NULL,
    public readonly string|array|null $value = NULL,
    public readonly ?string $fulltext = NULL,
    public readonly ?string $error = NULL,
    public readonly array $candidates = [],
  ) {}

  /**
   * TRUE when the line named a reference that could not be resolved.
   */
  public function failed(): bool {
    return $this->error !== NULL;
  }

  /**
   * TRUE when the line constrains nothing.
   */
  public function isEmpty(): bool {
    return $this->field === NULL && $this->fulltext === NULL && $this->error === NULL;
  }

}
