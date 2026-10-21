<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Entity;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\EntityOwnerInterface;

/**
 * One message addressed to one conductor, answered with a status and result.
 */
interface BbInboxMessageInterface extends ContentEntityInterface, EntityOwnerInterface {

  public const STATUS_PENDING = 'pending';
  public const STATUS_RUNNING = 'running';
  public const STATUS_DONE = 'done';
  public const STATUS_FAILED = 'failed';

  /**
   * The id of the message, e.g. `ports.up`; its handler is responsible.
   */
  public function messageId(): string;

  /**
   * The ticket the message is about.
   */
  public function ticket(): ?BbTicketInterface;

  /**
   * The conductor that has to execute the message.
   *
   * For a new message this is the ticket's conductor; once saved it is the
   * conductor captured at send time.
   */
  public function conductor(): ?BbConductorInterface;

  /**
   * The status: pending, running, done or failed.
   */
  public function status(): string;

  /**
   * The decoded payload.
   *
   * @return array<string, mixed>
   *   The payload; empty when absent or not a JSON object.
   */
  public function payload(): array;

  /**
   * The decoded result, NULL when none was written.
   *
   * @return array<string, mixed>|null
   *   The result.
   */
  public function result(): ?array;

  /**
   * Sets status and result.
   *
   * @param string $status
   *   The new status.
   * @param array<string, mixed>|object|null $result
   *   The result, or NULL for none. An object (decoded from JSON text) keeps
   *   its nested empty objects; an array's nested empty arrays stay lists.
   */
  public function setResult(string $status, array|object|null $result): static;

}
