<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use PHPUnit\Framework\Attributes\Group;

/**
 * The page-container link builder (BB-398 revision 2, D3).
 *
 * Its sibling suite, IslandRouteLinkTest, holds the other builder. Why both
 * render instead of asserting the build array is on IslandLinkTestBase.
 */
#[Group('island')]
final class IslandPageLinkTest extends IslandLinkTestBase {

  /**
   * The link addresses the page's container and replaces its contents.
   */
  public function testThePageLinkTargetsTheContainerAndSwapsItsContents(): void {
    $html = $this->renderIsland('page_link_demo');
    self::assertStringContainsString('data-hx-target="#page-content"', $html);
    self::assertStringContainsString('data-hx-swap="innerHTML"', $html);
    self::assertStringContainsString('data-hx-push-url="true"', $html);
    self::assertStringContainsString('data-hx-drupal-only-main-content', $html);
  }

  /**
   * The link selects nothing out of the response fragment.
   */
  public function testThePageLinkCarriesNoSelect(): void {
    // hx-select resolves against the response fragment, where a container the
    // PAGE owns does not appear (spec M2, M4). Selecting on it would yield an
    // empty fragment; the whole point of this builder is not to select.
    $html = $this->renderIsland('page_link_demo');
    self::assertStringNotContainsString('hx-select', $html);
  }

  /**
   * The link never suppresses the document title.
   */
  public function testThePageLinkNeverIgnoresTheTitle(): void {
    // Htmx::swap() defaults ignoreTitle to TRUE (spec M14). One word here
    // freezes the document title on whatever page the visitor started on.
    $html = $this->renderIsland('page_link_demo');
    self::assertStringNotContainsString('ignoreTitle', $html);
  }

  /**
   * The anchor keeps a working href, so a direct visit still works.
   */
  public function testThePageLinkKeepsItsHref(): void {
    $html = $this->renderIsland('page_link_demo');
    self::assertMatchesRegularExpression('#<a [^>]*href="/[^"]*"#', $html);
  }

  /**
   * URL options reach the built URL.
   */
  public function testThePageLinkCarriesUrlOptions(): void {
    // The pager case: the query string is a URL option, not a route parameter.
    $html = $this->renderIsland('page_link_demo');
    self::assertStringContainsString('page=2', $html);
  }

}
