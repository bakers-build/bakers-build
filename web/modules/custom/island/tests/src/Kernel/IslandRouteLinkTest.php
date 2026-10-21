<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use PHPUnit\Framework\Attributes\Group;

/**
 * The island link builder, and the target rule it defaults (BB-398 D3).
 *
 * The rule this pins is the whole of it: a component link addresses its OWN
 * island unless it names a target. Every other caller in the repository names
 * one, so without this suite the default branch ships unexercised — which is
 * how it stood until the review of 2026-08-28 measured it.
 *
 * Its sibling suite, IslandPageLinkTest, holds the other builder. Why both
 * render instead of asserting the build array is on IslandLinkTestBase.
 */
#[Group('island')]
final class IslandRouteLinkTest extends IslandLinkTestBase {

  /**
   * The html id the fixture's own island resolves to.
   *
   * Spelled out rather than recomputed from IslandPluginBase::getHtmlId(): a
   * test that derives the expected value from the code under test agrees with
   * it by construction. This is host id `tasks` plus plugin id `link_demo`.
   */
  private const OWN_ID = '#island-tasks-link_demo';

  /**
   * A link with no target addresses the island that wrote it.
   */
  public function testTheLinkDefaultsToItsOwnIslandId(): void {
    $html = $this->renderIsland('link_demo');
    self::assertStringContainsString('data-hx-target="' . self::OWN_ID . '"', $html);
    // hx-select resolves against the response fragment, and the island IS in
    // that fragment — which is the difference from linkToPage().
    self::assertStringContainsString('data-hx-select="' . self::OWN_ID . '"', $html);
  }

  /**
   * The island is replaced whole, not filled.
   */
  public function testTheLinkReplacesTheIslandItself(): void {
    $html = $this->renderIsland('link_demo');
    self::assertStringContainsString('data-hx-swap="outerHTML"', $html);
    self::assertStringContainsString('data-hx-drupal-only-main-content', $html);
  }

  /**
   * The link never suppresses the document title.
   */
  public function testTheLinkNeverIgnoresTheTitle(): void {
    // Htmx::swap() defaults ignoreTitle to TRUE (spec M14). One word here
    // freezes the document title on whatever page the visitor started on, and
    // this builder is the one the browser harness proves the title through.
    $html = $this->renderIsland('link_demo');
    self::assertStringNotContainsString('ignoreTitle', $html);
  }

  /**
   * The anchor keeps a working href, so a direct visit still works.
   */
  public function testTheLinkKeepsItsHref(): void {
    $html = $this->renderIsland('link_demo');
    self::assertMatchesRegularExpression('#<a [^>]*href="/island-test-other"#', $html);
  }

  /**
   * The push-url flag maps 1:1 onto the attribute, per anchor.
   *
   * Both anchors are asserted, not only the non-pushing one: an assertion that
   * only reads `false` would also pass against a builder that had stopped
   * writing the attribute for either link.
   */
  public function testThePushUrlFlagReachesEachAnchor(): void {
    $html = $this->renderIsland('link_demo');
    self::assertMatchesRegularExpression('#<a [^>]*data-hx-push-url="true"[^>]*>Pushing</a>#', $html);
    self::assertMatchesRegularExpression('#<a [^>]*data-hx-push-url="false"[^>]*>Not pushing</a>#', $html);
  }

}
