<?php

declare(strict_types=1);

namespace Drupal\bb_core\TicketTemplate;

/**
 * Thrown for a bad template definition caught at instantiation time.
 *
 * Covers an unknown `{{token}}` in title_pattern/description, and a
 * target_state with zero or more than one legal transition from the
 * generated ticket's initial state.
 */
final class TicketTemplateValidationException extends \RuntimeException {

}
