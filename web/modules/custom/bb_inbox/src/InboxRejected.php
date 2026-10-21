<?php

declare(strict_types=1);

namespace Drupal\bb_inbox;

/**
 * A message was rejected: no handler, a veto, or an invalid write (422).
 */
final class InboxRejected extends \RuntimeException {}
