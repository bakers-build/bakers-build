<?php

declare(strict_types=1);

namespace Drupal\bb_core;

/**
 * Byte limits for Markdown written through ticket tools.
 */
final class TicketWriteBudget {

  private const LIMITS = [
    'qualification' => 4096,
    'test' => 4096,
    'debug_diagnose' => 4096,
    'spec' => 6144,
    'plan' => 6144,
    'coding' => 6144,
    'review' => 6144,
    'acceptance' => 3072,
    'summary' => 3072,
    'retro' => 3072,
    'comment' => 8192,
  ];

  /**
   * Rejects oversized source before any entity is saved.
   */
  public static function check(string $body, ?string $type = NULL): void {
    $bytes = strlen($body);
    $limit = $type === NULL ? 6144 : (self::LIMITS[$type] ?? self::LIMITS['comment']);
    if ($bytes > $limit) {
      throw new \InvalidArgumentException(sprintf('%s is %d UTF-8 bytes; limit %d. Nothing stored. Shorten to bb-workflow/references/ticket-writes.md; keep reproducible evidence as command and commit.', $type ?? 'description', $bytes, $limit));
    }
  }

}
