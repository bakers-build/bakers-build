<?php

declare(strict_types=1);

namespace Drupal\bb_core\Claim;

/**
 * Thrown when a ticket cannot be claimed by the given conductor.
 */
class ClaimConflictException extends \RuntimeException {
}
