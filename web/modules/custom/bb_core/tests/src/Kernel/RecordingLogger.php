<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Logger\RfcLoggerTrait;
use Psr\Log\LoggerInterface;

/**
 * A logger that records one channel's records for a test to assert on.
 *
 * Registered through `LoggerChannelFactory::addLogger()`, which reaches every
 * channel — existing and future — so a test catches `\Drupal::logger($id)`
 * however the code under test resolves it.
 *
 * DELIBERATELY NOT A STOCK PSR TEST LOGGER. Drupal's `LoggerChannel` passes an
 * RFC 5424 INTEGER level rather than a PSR string, so `hasErrorRecords()` and
 * its siblings never match and a test built on them reads green while
 * asserting nothing. Records are kept raw and compared against
 * `RfcLogLevel::*` by the caller.
 */
final class RecordingLogger implements LoggerInterface {

  use RfcLoggerTrait;

  /**
   * Every record the watched channel emitted.
   *
   * @var array<int, array{level: mixed, message: string, context: array<string, mixed>}>
   */
  public array $records = [];

  /**
   * Constructs a recorder for one channel.
   *
   * @param string $channel
   *   The logger channel to record; every other channel is ignored.
   */
  public function __construct(private readonly string $channel) {}

  /**
   * {@inheritdoc}
   */
  public function log($level, string|\Stringable $message, array $context = []): void {
    if (($context['channel'] ?? '') !== $this->channel) {
      return;
    }
    $this->records[] = [
      'level' => $level,
      'message' => (string) $message,
      'context' => $context,
    ];
  }

  /**
   * Returns the first record at the given RFC level, or NULL.
   *
   * @param int $level
   *   An `RfcLogLevel::*` constant.
   *
   * @return array{level: mixed, message: string, context: array<string, mixed>}|null
   *   The record, or NULL when the channel emitted none at that level.
   */
  public function first(int $level): ?array {
    foreach ($this->records as $record) {
      if ($record['level'] === $level) {
        return $record;
      }
    }
    return NULL;
  }

}
