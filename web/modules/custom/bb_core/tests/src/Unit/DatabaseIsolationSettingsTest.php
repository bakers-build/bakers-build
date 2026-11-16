<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;

/**
 * Both database connections run READ COMMITTED, as core recommends.
 *
 * Under MariaDB's default REPEATABLE READ, parallel writers deadlock on shared
 * cache rows and a concurrent cache truncate breaks open snapshots.
 *
 * @group bb_core
 */
final class DatabaseIsolationSettingsTest extends UnitTestCase {

  private const READ_COMMITTED = 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED';

  private const ENV = [
    'IS_DDEV_PROJECT',
    'DB_HOST',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'DB_PORT',
    'DB_DRIVER',
  ];

  /**
   * The environment before the test, restored afterwards.
   *
   * @var array<string, string|false>
   */
  private array $savedEnv = [];

  protected function setUp(): void {
    parent::setUp();
    foreach (self::ENV as $name) {
      $this->savedEnv[$name] = getenv($name);
      putenv($name);
    }
  }

  protected function tearDown(): void {
    foreach ($this->savedEnv as $name => $value) {
      putenv($value === FALSE ? $name : "$name=$value");
    }
    parent::tearDown();
  }

  public function testLocalConnectionUsesReadCommitted(): void {
    $databases = $this->loadSettings();
    self::assertSame('db', $databases['default']['default']['host']);
    self::assertSame(self::READ_COMMITTED, $databases['default']['default']['init_commands']['isolation_level'] ?? NULL);
  }

  public function testContainerConnectionUsesReadCommitted(): void {
    putenv('DB_HOST=db.example');
    putenv('DB_NAME=bakers');
    putenv('DB_USER=bakers');
    putenv('DB_PASSWORD=secret');
    $databases = $this->loadSettings();
    self::assertSame('db.example', $databases['default']['default']['host']);
    self::assertSame(self::READ_COMMITTED, $databases['default']['default']['init_commands']['isolation_level'] ?? NULL);
  }

  /**
   * Evaluates the site's settings.php in an isolated scope.
   *
   * @return array<string, mixed>
   *   The resulting $databases array.
   */
  private function loadSettings(): array {
    $databases = [];
    $settings = [];
    $config = [];
    require $this->root . '/sites/default/settings.php';
    return $databases;
  }

}
