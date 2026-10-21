<?php

declare(strict_types=1);

namespace Drupal\bb_api_key;

/**
 * Disable blocked the account, but its cleanup did not fully complete.
 */
final class ServiceAccountCleanupException extends \RuntimeException {}
