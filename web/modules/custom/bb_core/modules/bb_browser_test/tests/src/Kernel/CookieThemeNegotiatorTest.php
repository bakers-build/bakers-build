<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_browser_test\Kernel;

use Drupal\bb_browser_test\Theme\CookieThemeNegotiator;
use Drupal\KernelTests\KernelTestBase;
use Symfony\Component\HttpFoundation\Request;

/**
 * The browser-test theme switch is per request, never per site.
 *
 * @group bb_core
 */
final class CookieThemeNegotiatorTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = ['system', 'island', 'bb_browser_test'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->container->get('theme_installer')->install(['stark']);
  }

  /**
   * A request that carries no cookie is not this negotiator's concern.
   */
  public function testNoCookieDoesNotApply(): void {
    $negotiator = $this->negotiatorFor(Request::create('/'));
    self::assertFalse($negotiator->applies($this->container->get('current_route_match')));
  }

  /**
   * The cookie names an installed theme, so it wins.
   */
  public function testCookieSelectsInstalledTheme(): void {
    $request = Request::create('/');
    $request->cookies->set(CookieThemeNegotiator::COOKIE_NAME, 'stark');
    $negotiator = $this->negotiatorFor($request);
    self::assertTrue($negotiator->applies($this->container->get('current_route_match')));
    self::assertSame('stark', $negotiator->determineActiveTheme($this->container->get('current_route_match')));
  }

  /**
   * A typo in the cookie must not disfigure the site.
   */
  public function testUninstalledThemeNameIsIgnored(): void {
    $request = Request::create('/');
    $request->cookies->set(CookieThemeNegotiator::COOKIE_NAME, 'not_a_real_theme');
    $negotiator = $this->negotiatorFor($request);
    self::assertFalse($negotiator->applies($this->container->get('current_route_match')));
    self::assertNull($negotiator->determineActiveTheme($this->container->get('current_route_match')));
  }

  /**
   * Builds a negotiator against the given request, pushed as the current one.
   */
  private function negotiatorFor(Request $request): CookieThemeNegotiator {
    $request->setSession($this->container->get('session'));
    $request_stack = $this->container->get('request_stack');
    $request_stack->push($request);
    return new CookieThemeNegotiator($request_stack, $this->container->get('theme_handler'));
  }

}
