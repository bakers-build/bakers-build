<?php

declare(strict_types=1);

namespace Drupal\bb_core\Conductor;

/**
 * Validates public machine addresses without normalizing their copyable text.
 */
final class MachineConnectionUrl {

  /**
   * Accepts the same SSH/HTTPS grammar as the CLI trust boundary.
   */
  public static function isValid(mixed $value): bool {
    if (!is_string($value) || mb_strlen($value) > 2048
      // Printable ASCII only, as in the CLI: link text cannot be spoofed.
      || preg_match('/[^\x21-\x7e]|\\\\/', $value)
      || preg_match('/%(?![0-9a-f]{2})/i', $value)
      || !mb_check_encoding(rawurldecode($value), 'UTF-8')
      || preg_match('/[\s\p{Cc}]/u', rawurldecode($value))) {
      return FALSE;
    }
    if (!preg_match('~^(ssh|https)://([^/?#]+)(.*)\z~i', $value, $parts)) {
      return FALSE;
    }
    $ssh = strtolower($parts[1]) === 'ssh';
    if ($ssh && !in_array($parts[3], ['', '/'], TRUE)) {
      return FALSE;
    }
    return self::validAuthority($parts[2], $ssh);
  }

  /**
   * Rejects credentials, malformed hosts and out-of-range ports.
   */
  private static function validAuthority(string $authority, bool $ssh): bool {
    $parts = explode('@', $authority);
    if (count($parts) > 2 || (!$ssh && count($parts) > 1)) {
      return FALSE;
    }
    if (count($parts) === 2 && ($parts[0] === '' || preg_match('~[:/?#@]~', rawurldecode($parts[0])))) {
      return FALSE;
    }
    if (!preg_match('/^(\[[^\]]+\]|[^:]+)(?::([0-9]+))?\z/', end($parts), $match)) {
      return FALSE;
    }
    $port_options = ['options' => ['min_range' => 1, 'max_range' => 65535]];
    if (isset($match[2]) && !filter_var((int) $match[2], FILTER_VALIDATE_INT, $port_options)) {
      return FALSE;
    }
    return self::validHost($match[1]);
  }

  /**
   * Accepts DNS labels, IPv4 or bracketed IPv6, never URL delimiters.
   */
  private static function validHost(string $host): bool {
    if (str_starts_with($host, '[')) {
      return filter_var(substr($host, 1, -1), FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== FALSE;
    }
    if (preg_match('/^[0-9.]+\z/', $host)) {
      return filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== FALSE;
    }
    if (strlen($host) > 253) {
      return FALSE;
    }
    foreach (explode('.', preg_replace('/\.$/', '', $host)) as $label) {
      if (!preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\z/i', $label)) {
        return FALSE;
      }
    }
    return TRUE;
  }

}
