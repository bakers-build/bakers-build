<?php

declare(strict_types=1);

namespace Drupal\bb_core\RunLog;

use Drupal\Core\Cache\CacheableDependencyInterface;
use Drupal\Core\Cache\UncacheableDependencyTrait;
use Drupal\Core\TypedData\Plugin\DataType\BooleanData;

/**
 * Boolean typed data that the serializer bubbles as max-age 0.
 */
final class UncachedBooleanData extends BooleanData implements CacheableDependencyInterface {

  use UncacheableDependencyTrait;

}
