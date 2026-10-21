<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Activity;

/**
 * How the activity feed reads one row; English literals, as in the feed.
 */
final class FeedMessage implements ActivityMessageInterface {

  /**
   * Constructs a feed line.
   *
   * @param string $tag
   *   The event tag.
   * @param string $statement
   *   The sentence after the ticket identifier.
   * @param string|null $role
   *   The role of a row without a run.
   * @param string|null $detail
   *   A detail line.
   * @param bool $duration
   *   Whether the run's duration is a fact of the row.
   * @param string|null $commentLink
   *   The label of the link to the row's comment.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public function __construct(
    public readonly string $tag,
    public readonly string $statement,
    public readonly ?string $role = NULL,
    public readonly ?string $detail = NULL,
    public readonly bool $duration = FALSE,
    public readonly ?string $commentLink = NULL,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function subject(): string {
    return $this->statement;
  }

  /**
   * {@inheritdoc}
   */
  public function body(): ?string {
    return $this->detail;
  }

  /**
   * The line as the activity event source consumes it.
   *
   * @return array{tag: string, statement: string, role?: string, detail?: string, duration?: bool, comment_link?: string}
   *   The feed line; unset parts are left out.
   */
  public function toLine(): array {
    return array_filter([
      'tag' => $this->tag,
      'statement' => $this->statement,
      'role' => $this->role,
      'detail' => $this->detail,
      'duration' => $this->duration ?: NULL,
      'comment_link' => $this->commentLink,
    ], static fn (mixed $value): bool => $value !== NULL);
  }

}
