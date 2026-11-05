<?php

declare(strict_types=1);

namespace Drupal\bb_core\Conductor;

use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * A new conductor_id whose machine, project and variant have a conductor.
 *
 * Carries the conductors the client may take over, so it does not have to
 * parse them out of the message.
 */
final class ConductorTakeoverOffer extends ConflictHttpException {

  /**
   * Builds the offer.
   *
   * @param string $message
   *   How to decide.
   * @param list<array{uuid: string, label: string, conductor_id: string, last_seen: int}> $candidates
   *   The conductors offered for takeover.
   */
  public function __construct(string $message, public readonly array $candidates) {
    parent::__construct($message);
  }

}
