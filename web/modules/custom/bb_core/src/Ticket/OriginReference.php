<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

/**
 * One origin issue, reduced to the pair that identifies it.
 *
 * The stored origin is a full URL whose spelling nobody controls: scheme, host,
 * a `.git` suffix, a trailing slash and GitLab's `/-/` segment all vary. This
 * reduces every spelling of one issue to `<repository path>#<number>`, so the
 * lookup is an exact string comparison. That is also what keeps `#19` from
 * matching `#190`, which a substring or ENDS_WITH comparison on the URL cannot.
 */
final class OriginReference {

  private function __construct(
    public readonly string $repositoryPath,
    public readonly int $number,
  ) {}

  /**
   * Reads an issue URL, or NULL when the URL names no issue.
   */
  public static function fromUrl(string $url): ?self {
    $url = trim($url);
    if ($url === '' || !preg_match('#^[a-z][a-z0-9+.-]*://#i', $url)) {
      return NULL;
    }
    $path = parse_url($url, PHP_URL_PATH);
    if (!is_string($path)) {
      return NULL;
    }
    // `/group/project/-/issues/19` and `/group/project/issues/19` both occur;
    // the `/-/` separator is GitLab's and is optional in older links.
    if (!preg_match('#^/(?<path>.+?)/(?:-/)?issues/(?<number>\d+)/?$#', $path, $matches)) {
      return NULL;
    }
    $number = (int) $matches['number'];
    return $number > 0 ? new self(self::normalisePath($matches['path']), $number) : NULL;
  }

  /**
   * The index key: `<repository path>#<number>`, lowercased.
   */
  public function key(): string {
    return self::keyFor($this->repositoryPath, $this->number);
  }

  /**
   * The index key for a path and a number that were resolved separately.
   */
  public static function keyFor(string $repositoryPath, int $number): string {
    return self::normalisePath($repositoryPath) . '#' . $number;
  }

  /**
   * Splits `#19`, `bakers#19` or `sym#1234`; NULL when the input is not one.
   *
   * @return array{alias: string|null, number: int}|null
   *   The alias (lowercased, NULL when absent) and the issue number.
   */
  public static function parseShortReference(string $input): ?array {
    $input = trim($input);
    if (!preg_match('#^(?<alias>[A-Za-z0-9._-]*)\#(?<number>\d+)$#', $input, $matches)) {
      return NULL;
    }
    $number = (int) $matches['number'];
    if ($number <= 0) {
      return NULL;
    }
    $alias = $matches['alias'] === '' ? NULL : mb_strtolower($matches['alias']);
    return ['alias' => $alias, 'number' => $number];
  }

  /**
   * The repository path of a repository URL: `bakers-build/bakers-build`.
   */
  public static function pathOf(string $repositoryUrl): ?string {
    $url = trim($repositoryUrl);
    if ($url === '') {
      return NULL;
    }
    // Scp shorthand — `git@host:group/project.git` — has no scheme and parses
    // as a path, so it is rewritten before `parse_url` sees it.
    $path = preg_match('#^[^/@]+@[^/:]+:(?<path>.+)$#', $url, $matches)
      ? $matches['path']
      : parse_url($url, PHP_URL_PATH);
    if (!is_string($path)) {
      return NULL;
    }
    $path = self::normalisePath($path);
    return $path === '' ? NULL : $path;
  }

  /**
   * The alias of a repository URL: the last path segment, `bakers`.
   */
  public static function aliasOf(string $repositoryUrl): ?string {
    $path = self::pathOf($repositoryUrl);
    if ($path === NULL) {
      return NULL;
    }
    $segments = explode('/', $path);
    $last = end($segments);
    return $last === '' ? NULL : $last;
  }

  /**
   * Lowercases a path and strips the leading slash and the `.git` suffix.
   */
  private static function normalisePath(string $path): string {
    $path = mb_strtolower(trim($path));
    $path = preg_replace('#\.git$#', '', $path) ?? $path;
    return trim($path, '/');
  }

}
