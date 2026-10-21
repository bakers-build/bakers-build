<?php

declare(strict_types=1);

namespace Drupal\bb_browser_test\Theme;

use Drupal\Core\Extension\ThemeHandlerInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Theme\ThemeNegotiatorInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Switches the active theme per request/browser-context, never per site.
 *
 * Replaces a browser scenario writing `system.theme:default` for the run of
 * the suite: a site-wide theme switch is a resource a parallel worker also
 * reads, so one worker's assertion depended on another worker not yet having
 * restored it. A cookie scopes the switch to the browser context that set it.
 */
final class CookieThemeNegotiator implements ThemeNegotiatorInterface {

  public const COOKIE_NAME = 'bb_browser_test_theme';

  public function __construct(
    private readonly RequestStack $requestStack,
    private readonly ThemeHandlerInterface $themeHandler,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function applies(RouteMatchInterface $route_match): bool {
    return $this->determineActiveTheme($route_match) !== NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function determineActiveTheme(RouteMatchInterface $route_match): ?string {
    $theme = $this->requestStack->getCurrentRequest()?->cookies->get(self::COOKIE_NAME);
    if (!$theme || !$this->themeHandler->themeExists($theme)) {
      return NULL;
    }
    return $theme;
  }

}
