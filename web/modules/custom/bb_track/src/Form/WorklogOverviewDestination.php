<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Component\Utility\UrlHelper;
use Symfony\Component\HttpFoundation\Request;

/**
 * Validates a local time calendar destination from a request.
 */
final class WorklogOverviewDestination {

  /**
   * Returns a local workspace overview destination from the request, or NULL.
   */
  public static function fromRequest(Request $request): ?string {
    $raw = $request->query->get('destination');
    if (!is_string($raw) || $raw === '' || UrlHelper::isExternal($raw) || str_starts_with($raw, '//')) {
      return NULL;
    }
    $parsed = UrlHelper::parse($raw);
    $path = '/' . ltrim((string) ($parsed['path'] ?? ''), '/');
    $incoming = $parsed['query'] ?? [];
    if (!is_array($incoming) || !self::isOverviewPath($path)) {
      return NULL;
    }
    $query = self::query($incoming);
    if ($query === NULL) {
      return NULL;
    }
    return $path . ($query === [] ? '' : '?' . http_build_query($query));
  }

  /**
   * Time calendars and the complete submission review.
   */
  private const CALENDAR_ROUTES = [
    'view.worklog.page',
    'view.worklog.personal',
    'view.worklog.team',
    'view.worklog.project',
    'entity.bb_track_submission.canonical',
  ];

  /**
   * True when the path is one of the time calendars.
   */
  private static function isOverviewPath(string $path): bool {
    // The router applies inbound path processing itself; core's path
    // validator would apply it twice and cannot resolve workspace paths.
    try {
      $match = \Drupal::service('router.no_access_checks')->matchRequest(Request::create($path));
    }
    catch (\Exception) {
      return FALSE;
    }
    return in_array($match['_route'] ?? '', self::CALENDAR_ROUTES, TRUE);
  }

  /**
   * Keeps only valid overview query keys.
   *
   * @param array<string, mixed> $incoming
   *   Raw query.
   *
   * @return array<string, string>|null
   *   Filtered query, or NULL when a present value is invalid.
   */
  private static function query(array $incoming): ?array {
    $allowed = [
      'mode' => '/^(day|week)$/',
      'date' => '/^\d{4}-\d{2}-\d{2}$/',
      'project' => '/^[1-9]\d*$/',
      'ticket' => '/^[1-9]\d*$/',
      'person' => '/^[1-9]\d*$/',
      'submission' => '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/',
      // Week rows added in the Add row dialog, "project:ticket" listed.
      'rows' => '/^[1-9]\d*:\d+(,[1-9]\d*:\d+)*$/',
    ];
    $query = [];
    foreach ($allowed as $key => $pattern) {
      if (!array_key_exists($key, $incoming) || $incoming[$key] === '' || $incoming[$key] === NULL) {
        continue;
      }
      if (!is_string($incoming[$key]) || preg_match($pattern, $incoming[$key]) !== 1) {
        return NULL;
      }
      $query[$key] = $incoming[$key];
    }
    return $query;
  }

}
