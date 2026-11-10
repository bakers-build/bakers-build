<?php

declare(strict_types=1);

namespace Drupal\bb_core\Project;

/**
 * The source a ticket's Origin URL came from, as a labelled link.
 *
 * GitLab and GitHub give the repository path, Jira the project key, any other
 * host the host itself. A URL that is not http(s) with a host names no source.
 */
final class OriginSource {

  /**
   * Reads an Origin URL, or NULL when it names no source.
   *
   * @return array{label: string, url: string}|null
   *   The link text and the source's own URL.
   */
  public static function fromUrl(string $url): ?array {
    $parts = parse_url(trim($url));
    if (!is_array($parts) || !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], TRUE)) {
      return NULL;
    }
    $host = strtolower($parts['host'] ?? '');
    if ($host === '') {
      return NULL;
    }
    $base = strtolower($parts['scheme']) . '://' . $host;
    $path = $parts['path'] ?? '';

    if (preg_match('#^/browse/(?<key>[A-Za-z][A-Za-z0-9_]*)-\d+/?$#', $path, $match)) {
      return ['label' => 'Jira - ' . $match['key'], 'url' => $base . '/browse/' . $match['key']];
    }
    $provider = match (TRUE) {
      $host === 'github.com' => 'GitHub',
      str_contains($host, 'gitlab') => 'GitLab',
      default => NULL,
    };
    // The repository path is what precedes `/-/issues/` or `/issues/`.
    if ($provider !== NULL && preg_match('#^/(?<repo>.+?)/(?:-/)?issues/\d+/?$#', $path, $match)) {
      return ['label' => $provider . ' - ' . $match['repo'], 'url' => $base . '/' . $match['repo']];
    }
    return ['label' => $host, 'url' => $base];
  }

}
