<?php

declare(strict_types=1);

namespace Drupal\bb_board;

use Drupal\Core\Session\AccountInterface;
use Drupal\user\UserDataInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * The Board display preferences: Details and Done open/closed.
 *
 * The toggle links carry `details=states|phases` and `done=show|hide`. A valid
 * value in the request wins and is stored per account in user.data, one
 * setting for all projects; a request without one reads the stored value.
 */
final class BoardPreferences {

  private const MODULE = 'bb_board';

  /**
   * Request parameter, accepted values and user.data key, by preference.
   *
   * The first value is the stored-as-TRUE one.
   */
  private const PREFERENCES = [
    'details' => ['param' => 'details', 'on' => 'states', 'off' => 'phases'],
    'done_open' => ['param' => 'done', 'on' => 'show', 'off' => 'hide'],
  ];

  public function __construct(
    private readonly UserDataInterface $userData,
    private readonly AccountInterface $currentUser,
    private readonly RequestStack $requestStack,
  ) {}

  /**
   * Whether the Details toggle shows States; the default is Phases.
   */
  public function details(): bool {
    return $this->read('details');
  }

  /**
   * Whether the Done column is open; the default is closed.
   */
  public function doneOpen(): bool {
    return $this->read('done_open');
  }

  /**
   * Whether Done shows older tickets; set by the request only, never stored.
   */
  public function doneOlder(): bool {
    return $this->requestStack->getCurrentRequest()?->query->get('done_older') === '1';
  }

  /**
   * Stores the valid preference parameters of the current request.
   *
   * An unknown value is ignored; anonymous visitors have no user.data.
   */
  public function rememberRequest(): void {
    if ($this->currentUser->isAnonymous()) {
      return;
    }
    foreach (array_keys(self::PREFERENCES) as $key) {
      $value = $this->fromRequest($key);
      if ($value !== NULL) {
        $this->userData->set(self::MODULE, (int) $this->currentUser->id(), $key, $value);
      }
    }
  }

  /**
   * The request's value for one preference, NULL when absent or invalid.
   */
  private function fromRequest(string $key): ?bool {
    $definition = self::PREFERENCES[$key];
    $raw = $this->requestStack->getCurrentRequest()?->query->get($definition['param']);
    return match ($raw) {
      $definition['on'] => TRUE,
      $definition['off'] => FALSE,
      default => NULL,
    };
  }

  /**
   * The request's value if valid, else the stored one, else FALSE.
   */
  private function read(string $key): bool {
    $fromRequest = $this->fromRequest($key);
    if ($fromRequest !== NULL) {
      return $fromRequest;
    }
    if ($this->currentUser->isAnonymous()) {
      return FALSE;
    }
    return (bool) $this->userData->get(self::MODULE, (int) $this->currentUser->id(), $key);
  }

}
