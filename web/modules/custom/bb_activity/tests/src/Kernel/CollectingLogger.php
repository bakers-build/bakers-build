<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Core\Logger\RfcLoggerTrait;
use Psr\Log\LoggerInterface;

/**
 * Keeps every log record, so a test can see what a failure logged.
 */
final class CollectingLogger implements LoggerInterface {

  use RfcLoggerTrait;

  /**
   * Every record, in order.
   *
   * @var list<array{level: int, message: string, context: array<string, mixed>}>
   */
  public array $records = [];

  /**
   * {@inheritdoc}
   *
   * @param mixed $level
   *   The RFC log level.
   * @param string|\Stringable $message
   *   The message with placeholders.
   * @param array<string, mixed> $context
   *   The placeholders and the channel.
   */
  public function log($level, string|\Stringable $message, array $context = []): void {
    $this->records[] = ['level' => (int) $level, 'message' => (string) $message, 'context' => $context];
  }

  /**
   * The messages one channel logged at one RFC level, placeholders filled in.
   *
   * @return list<string>
   *   The messages, in order.
   */
  public function messages(string $channel, int $level): array {
    $messages = [];
    foreach ($this->records as $record) {
      if ($record['level'] === $level && ($record['context']['channel'] ?? '') === $channel) {
        $messages[] = strtr($record['message'], array_filter($record['context'], 'is_scalar'));
      }
    }
    return $messages;
  }

}
