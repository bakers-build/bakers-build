<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\Database\Connection;
use Drupal\Core\Lock\LockBackendInterface;

/**
 * Serializes personal mutations until their enclosing transaction completes.
 */
final class WorkTimeMutation {

  /**
   * Locks already held by this request, including nested entity saves.
   *
   * @var array<string, bool>
   */
  private array $held = [];

  /**
   * Constructs the mutation boundary.
   */
  public function __construct(private Connection $database, private LockBackendInterface $lock) {}

  /**
   * Runs an atomic operation under the owner or configuration lock.
   */
  public function run(string $identity, callable $operation): mixed {
    $key = 'bb_track:' . $identity;
    if (isset($this->held[$key])) {
      return $operation();
    }
    $mysql = $this->database->driver() === 'mysql';
    $acquired = $mysql
      ? (int) $this->database->query('SELECT GET_LOCK(:key, 0)', [':key' => $key])->fetchField() === 1
      : $this->lock->acquire($key, 300.0);
    if (!$acquired) {
      throw new \RuntimeException('Time data is being changed. Refresh and retry.');
    }
    $this->held[$key] = TRUE;
    $transaction = $this->database->startTransaction();
    $this->database->transactionManager()->addPostTransactionCallback(function () use ($key, $mysql): void {
      unset($this->held[$key]);
      if ($mysql) {
        $this->database->query('SELECT RELEASE_LOCK(:key)', [':key' => $key]);
        return;
      }
      $this->lock->release($key);
    });
    try {
      $result = $operation();
      unset($transaction);
      return $result;
    }
    catch (\Throwable $error) {
      $transaction->rollBack();
      throw $error;
    }
  }

}
