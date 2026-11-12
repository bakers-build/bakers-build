<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Kernel;

use Drupal\bb_board\BoardPreferences;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Details and Done open/closed are remembered per account in user.data.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BoardPreferencesTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'bb_core', 'bb_board',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installSchema('user', ['users_data']);
    // Uid 1 is the superuser; the accounts below are ordinary.
    $this->createUser();
    $this->setUpCurrentUser();
  }

  /**
   * Serves the next request and returns the preference service.
   *
   * @param array<string, string> $query
   *   The request's query parameters.
   */
  private function request(array $query = []): BoardPreferences {
    $this->container->get('request_stack')->getCurrentRequest()->query->replace($query);
    $preferences = $this->container->get('bb_board.preferences');
    self::assertInstanceOf(BoardPreferences::class, $preferences);
    $preferences->rememberRequest();
    return $preferences;
  }

  /**
   * A first visit shows Phases and a closed Done column.
   */
  public function testDefaultsArePhasesAndDoneClosed(): void {
    $preferences = $this->request();
    self::assertFalse($preferences->details());
    self::assertFalse($preferences->doneOpen());
    self::assertFalse($preferences->doneOlder());
  }

  /**
   * A parameter is stored and wins; a later request without it reads it back.
   */
  public function testParameterIsStoredAndWins(): void {
    self::assertTrue($this->request(['details' => 'states', 'done' => 'show'])->details());
    $next = $this->request();
    self::assertTrue($next->details());
    self::assertTrue($next->doneOpen());

    $back = $this->request(['details' => 'phases', 'done' => 'hide']);
    self::assertFalse($back->details());
    self::assertFalse($back->doneOpen());
    self::assertFalse($this->request()->details());
  }

  /**
   * Another account keeps its own defaults.
   */
  public function testPerAccount(): void {
    $this->request(['details' => 'states', 'done' => 'show']);
    $this->setCurrentUser($this->createUser() ?: throw new \LogicException('No user.'));
    $other = $this->request();
    self::assertFalse($other->details());
    self::assertFalse($other->doneOpen());
  }

  /**
   * An unknown value is ignored and the stored value stays.
   */
  public function testInvalidValueIsIgnored(): void {
    $this->request(['details' => 'states', 'done' => 'show']);
    $preferences = $this->request(['details' => 'foo', 'done' => 'bar']);
    self::assertTrue($preferences->details());
    self::assertTrue($preferences->doneOpen());
    self::assertTrue($this->request()->details());

    $this->setCurrentUser($this->createUser() ?: throw new \LogicException('No user.'));
    self::assertFalse($this->request(['details' => 'foo'])->details());
  }

  /**
   * Show older lives in the request only and is never remembered.
   */
  public function testDoneOlderComesOnlyFromRequest(): void {
    self::assertTrue($this->request(['done_older' => '1'])->doneOlder());
    self::assertFalse($this->request()->doneOlder());
    self::assertFalse($this->request(['done_older' => 'yes'])->doneOlder());
  }

  /**
   * An anonymous visitor writes no user.data row.
   */
  public function testAnonymousStoresNothing(): void {
    $this->setCurrentUser(new AnonymousUserSession());
    $this->request(['details' => 'states']);
    self::assertSame([], $this->container->get('user.data')->get('bb_board', 0));
    self::assertFalse($this->request()->details());
  }

}
