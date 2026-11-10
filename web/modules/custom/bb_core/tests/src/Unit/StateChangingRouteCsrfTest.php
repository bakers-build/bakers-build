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
   * Pages declared without `methods:` that only render.
   *
   * They answer every method; what changes state on them is an embedded form,
   * which carries its own form token. A new route goes here only on review.
   */
  private const RENDER_ONLY_PAGES = [
    'bb_addon.overlay',
    'bb_core.home',
    'bb_core.my_work.stats',
    'bb_core.workspace.insights',
    'bb_core.review_transition',
    'bb_core.bb_workspace.members',
    'bb_core.run_log_download',
    'bb_core.run_log_download_api',
    'bb_track.workspace.insights_billing',
    'bb_browser_test.profiles',
    'bb_browser_test.mapping',
    'bb_browser_test.menu_first',
    'bb_browser_test.menu_second',
    'bb_browser_test.conditional_first',
    'bb_browser_test.conditional_second',
  ];

  /**
   * Every route that accepts cookies and a state-changing method has a token.
   */
  public function testCookieRoutesThatChangeStateRequireTheCsrfHeader(): void {
    $root = dirname(__DIR__, 7) . '/web/modules/custom';
    $files = array_merge(glob($root . '/*/*.routing.yml') ?: [], glob($root . '/*/modules/*/*.routing.yml') ?: []);
    self::assertNotEmpty($files);

    $routes = [];
    foreach ($files as $file) {
      $routes += Yaml::parseFile($file) ?? [];
    }
    self::assertSame([], self::missingToken(array_diff_key($routes, array_flip(self::RENDER_ONLY_PAGES))));
  }

  /**
   * A route without `methods:` answers POST too, so it needs the token.
   */
  public function testRouteWithoutMethodsCountsAsStateChanging(): void {
    $route = ['path' => '/x', 'defaults' => ['_controller' => 'X::y'], 'requirements' => ['_permission' => 'any']];
    self::assertSame(['open'], self::missingToken(['open' => $route, 'get' => $route + ['methods' => ['GET']]]));
  }

  /**
   * The names of routes that change state under a cookie without a token.
   *
   * @param array<string, mixed> $routes
   *   Parsed routing definitions, keyed by route name.
   *
   * @return list<string>
   *   The offending route names.
   */
  private static function missingToken(array $routes): array {
    $missing = [];
    foreach ($routes as $name => $route) {
      $methods = array_map('strtoupper', (array) ($route['methods'] ?? ['POST']));
      $auth = $route['options']['_auth'] ?? NULL;
      if (!array_diff($methods, ['GET', 'HEAD', 'OPTIONS']) || ($auth !== NULL && !in_array('cookie', $auth, TRUE))) {
        continue;
      }
      // A form carries its own form token; a public route acts as nobody.
      $exempt = isset($route['defaults']['_form']) || isset($route['defaults']['_entity_form'])
        || ($route['requirements']['_access'] ?? NULL) === 'TRUE';
      if (!$exempt && !isset($route['requirements']['_csrf_request_header_token']) && !isset($route['requirements']['_csrf_token'])) {
        $missing[] = (string) $name;
      }
    }
    return $missing;
  }

}
