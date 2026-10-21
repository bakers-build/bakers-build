<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Component\Utility\Html;

/**
 * Generates deterministic ids for profile placement wrappers.
 */
final class IslandRuntimeId {

  /**
   * Encodes the complete identity tuple without ambiguous separators.
   */
  public static function forHost(string $app_id, string $profile_id, string $instance_id): string {
    return 'profile_' . bin2hex(json_encode([$app_id, $profile_id, $instance_id], JSON_THROW_ON_ERROR));
  }

  /**
   * Builds an id independent of slot, weight and render order.
   */
  public static function forPlacement(string $app_id, string $profile_id, string $instance_id, string $placement_id): string {
    $host_id = self::forHost($app_id, $profile_id, $instance_id);
    return Html::cleanCssIdentifier(implode('-', [
      'island',
      $host_id,
      $placement_id,
    ]), [':' => '-', ' ' => '-', '/' => '-', '[' => '-', ']' => '']);
  }

}
