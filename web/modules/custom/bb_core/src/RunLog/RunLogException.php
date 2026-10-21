<?php

declare(strict_types=1);

namespace Drupal\bb_core\RunLog;

/**
 * Raised when a run log cannot be written or read.
 *
 * Messages are deliberately generic: a transcript can contain credentials, so
 * neither the payload nor a path under the private root ever reaches a message,
 * a log line, or a response.
 */
final class RunLogException extends \RuntimeException {
}
