<?php

declare(strict_types=1);

namespace Drupal\bb_core\TicketTemplate;

/**
 * Thrown when the acting account lacks permission to instantiate a template.
 */
final class TicketTemplateAccessDeniedException extends \RuntimeException {

}
