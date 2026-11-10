<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * Custom state-changing routes open to cookie sign-in carry the CSRF header.
 *
 * Core checks `_csrf_request_header_token` only for cookie sessions, so
 * bearer-token clients are unaffected while another site cannot act through
 * a browser's session. Asserted over every custom routing file, so the next
 * route without the token fails here.
 */
#[Group('bb_core')]
final class StateChangingRouteCsrfTest extends UnitTestCase {

  /**
   * Every POST/PUT/PATCH/DELETE route that accepts cookies requires the token.
   */
  public function testCookieRoutesThatChangeStateRequireTheCsrfHeader(): void {
    $root = dirname(__DIR__, 7) . '/web/modules/custom';
    $files = array_merge(glob($root . '/*/*.routing.yml') ?: [], glob($root . '/*/modules/*/*.routing.yml') ?: []);
    self::assertNotEmpty($files);

    $missing = [];
    foreach ($files as $file) {
      foreach (Yaml::parseFile($file) ?? [] as $name => $route) {
        $methods = array_map('strtoupper', (array) ($route['methods'] ?? []));
        $auth = $route['options']['_auth'] ?? NULL;
        if (!array_diff($methods, ['GET', 'HEAD', 'OPTIONS']) || ($auth !== NULL && !in_array('cookie', $auth, TRUE))) {
          continue;
        }
        // A form carries its own form token; a public route acts as nobody.
        $exempt = isset($route['defaults']['_form']) || ($route['requirements']['_access'] ?? NULL) === 'TRUE';
        if (!$exempt && !isset($route['requirements']['_csrf_request_header_token']) && !isset($route['requirements']['_csrf_token'])) {
          $missing[] = $name;
        }
      }
    }
    self::assertSame([], $missing);
  }

}
