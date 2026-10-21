<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Event;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Symfony\Contracts\EventDispatcher\Event;

/**
 * Asks who is responsible for a message, and whether it may be written.
 *
 * Dispatched when a message is created (op `create`) and whenever its status
 * changes (op `result`). The subscriber that handles the message id claims
 * it; it may veto (422) or, on create, deny (403). An unclaimed message is
 * rejected by the inbox.
 */
final class InboxMessageEvent extends Event {

  public const NAME = 'bb_inbox.message';
  public const OP_CREATE = 'create';
  public const OP_RESULT = 'result';

  /**
   * The claiming handler, NULL until claimed.
   */
  private ?string $handler = NULL;

  /**
   * The claiming handler's version.
   */
  private ?string $version = NULL;

  /**
   * Veto reasons.
   *
   * @var array<string>
   */
  private array $vetoes = [];

  /**
   * The denial reason, NULL when not denied.
   */
  private ?string $denied = NULL;

  public function __construct(
    public readonly BbInboxMessageInterface $message,
    public readonly string $op,
    public readonly AccountInterface $account,
  ) {}

  /**
   * Declares responsibility for the message.
   *
   * @throws \LogicException
   *   Another handler already claimed it.
   */
  public function claim(string $handler, string $version): void {
    if ($this->handler !== NULL && $this->handler !== $handler) {
      throw new \LogicException(sprintf('Message already claimed by %s.', $this->handler));
    }
    $this->handler = $handler;
    $this->version = $version;
  }

  /**
   * Rejects the write with a reason.
   */
  public function veto(string $reason): void {
    $this->vetoes[] = $reason;
  }

  /**
   * Denies create access with a reason.
   */
  public function deny(string $reason): void {
    $this->denied = $reason;
  }

  /**
   * Whether a handler claimed the message.
   */
  public function isClaimed(): bool {
    return $this->handler !== NULL;
  }

  /**
   * The claiming handler's version.
   */
  public function version(): ?string {
    return $this->version;
  }

  /**
   * The veto reasons.
   *
   * @return array<string>
   *   The reasons.
   */
  public function vetoes(): array {
    return $this->vetoes;
  }

  /**
   * The denial reason, NULL when not denied.
   */
  public function denied(): ?string {
    return $this->denied;
  }

}
