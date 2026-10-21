<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\island_test\Controller\ConfiguredIslandPageController;
use Drupal\island_test\Plugin\Block\SentinelBlock;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The declaration a CONFIGURED island renders, and re-renders (BB-396 T6/T7).
 *
 * `IslandSourcePluginModeTest` covers the other mode and the id round trip; it
 * never renders and never issues a request, so nothing in the tree observed the
 * two properties this class exists for.
 *
 * THE FIRST is F10, the exact defect that broke this mechanism's first
 * delivery. The declaration used to be applied by the CALLER, so every swapped
 * fragment came back bare and a boosted navigation worked exactly once per page
 * load — measured then as `rail attrs AFTER the click: []`. One request cannot
 * see it: the first page build carries the declaration either way. So the
 * subject here is the response a BOOSTED GET receives, which is what replaces
 * the container and therefore what the SECOND click reads its declaration from.
 *
 * WHY THAT RESPONSE IS A WHOLE PAGE RATHER THAN A FRAGMENT, and it is not a
 * defect. `IslandHostResolver::resolveHtmlId()` parses
 * `island-<host>-<plugin>`; a configuration-mode id is not one, so
 * `IslandGetSubscriber` falls through and the ordinary page is served for htmx
 * to extract from through `hx-select` (spec F40). The declaration's survival
 * therefore rides on the page being REBUILT through the source — which is
 * exactly what would stop being true if someone "optimised" the subscriber into
 * answering a configured id with a bare fragment. That change is what these
 * assertions are aimed at, and the ones in `IslandGetPathTest` cannot see it:
 * they assert the fall-through on a page that carries no configured island at
 * all, so they say nothing about what the fall-through has to preserve.
 *
 * THE SECOND is D3's negative and it is structural rather than behavioural. The
 * rail must NOT ride along with a tab click. The tab bar carries no declaration
 * of its own — it is positioned inside the content island — so a tab link is
 * handed the CONTENT island's declaration by htmx's closest-attribute lookup.
 * That declaration naming no out-of-band island is the entire mechanism, and it
 * is a property of the content island's markup, which is why it is asserted
 * there rather than on a header.
 */
#[Group('island')]
final class IslandSourceConfiguredModeTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * `ui_patterns` is not a declared dependency of `island_test`, deliberately:
   * three sibling kernel tests enable that fixture module WITHOUT ui_patterns,
   * and a hard dependency would force it on all of them. The fixture route's
   * controller is only autoloaded when the route is requested, so declaring the
   * pair here is enough.
   *
   * @var array<string>
   */
  protected static $modules = ['system', 'user', 'ui_patterns', 'island', 'island_test'];

  /**
   * The whole declaration a container targeting SOMETHING ELSE carries.
   *
   * Six attribute NAMES, sorted. The names are the assertion rather than the
   * values because what a broken swap loses is the whole declaration, not one
   * value of it — which is the shape `IslandGetPathTest` established.
   *
   * @var array<string>
   */
  private const RIDES_ALONG = [
    'data-hx-boost', 'data-hx-headers', 'data-hx-select',
    'data-hx-select-oob', 'data-hx-swap', 'data-hx-target',
  ];

  /**
   * The declaration a container that is its OWN target carries.
   *
   * Four, not six. The two missing ones are the point: `hx-select-oob` and the
   * `X-Island-Also` header are what make a fragment ride along, and an island
   * that is already the main fragment cannot ride along with itself.
   *
   * @var array<string>
   */
  private const RIDES_ALONE = [
    'data-hx-boost', 'data-hx-select', 'data-hx-swap', 'data-hx-target',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // Constructing ANY ui_patterns source reaches the context repository, whose
    // current-user provider loads the account — so without the table every case
    // here dies before it asserts.
    $this->installEntitySchema('user');
    $this->installConfig(['system']);
    $this->container->get('theme_installer')->install(['stark']);
    $this->container->get('config.factory')->getEditable('system.theme')
      ->set('default', 'stark')->save();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The rail's rendered container carries the whole declaration, with values.
   *
   * Rendered, not configured: `display_builder` drops an invalid prop silently,
   * so a test that read the settings back would have proved nothing about what
   * a browser receives.
   */
  public function testTheRailContainerRendersTheWholeDeclaration(): void {
    $html = $this->renderedPage();

    self::assertSame(
      self::RIDES_ALONE,
      $this->declarationAttributes($html, ConfiguredIslandPageController::CONTENT_ID),
    );
    self::assertSame(
      self::RIDES_ALONG,
      $this->declarationAttributes($html, ConfiguredIslandPageController::RAIL_ID),
    );

    $rail = $this->elementOf($html, ConfiguredIslandPageController::RAIL_ID);
    self::assertStringContainsString('data-hx-target="#island-content"', $rail);
    self::assertStringContainsString(
      'data-hx-select="#island-content"',
      $rail,
      'Without hx-select the whole page lands inside the island (F40).',
    );
    self::assertStringContainsString('data-hx-swap="outerHTML"', $rail);
    self::assertStringContainsString(
      'data-hx-select-oob="#island-rail"',
      $rail,
      'A rail click replaces the content and brings the rail back with it.',
    );
    self::assertStringContainsString('X-Island-Also', $rail);
  }

  /**
   * D3's NEGATIVE: nothing in the content island's markup makes the rail ride.
   *
   * A tab link declares nothing of its own — the tab bar is positioned inside
   * the content island rather than islandified — so htmx hands it the closest
   * ancestor's declaration, which is this one. It names no out-of-band island
   * and sends no `X-Island-Also`, and that is the whole of "a tab click
   * re-renders the body and leaves the rail as it was".
   *
   * Adding `->also('island-rail')` here — the obvious way to "fix" the rail's
   * stale active entry (F6) — turns every tab click into a menu render, which
   * is the cost this architecture exists to avoid. This is what refuses it.
   */
  public function testTheContentIslandDeclaresNoRidingAlong(): void {
    $content = $this->elementOf($this->renderedPage(), ConfiguredIslandPageController::CONTENT_ID);

    self::assertStringNotContainsString('data-hx-select-oob', $content);
    self::assertStringNotContainsString('data-hx-headers', $content);
    self::assertStringContainsString(
      'data-hx-target="#island-content"',
      $content,
      'It replaces itself, so it is its own target.',
    );
  }

  /**
   * AC 2: the island contributes its container and nothing else.
   *
   * Only the complete page variant owns pass-through page/region templates.
   * Individual islands still contribute no layout: the wrapped content comes
   * out byte for byte, with one element around it.
   */
  public function testTheIslandAddsNothingButItsContainer(): void {
    self::assertSame(
      ['templates/page.html.twig', 'templates/region.html.twig'],
      $this->shippedTemplates(),
      'Only the complete page variant may ship page/region pass-through templates.',
    );

    $inside = $this->insideOf(
      $this->renderedPage(),
      ConfiguredIslandPageController::CONTENT_ID,
    );
    self::assertSame(
      SentinelBlock::MARKUP,
      $inside,
      'The container wraps the content and adds no markup of its own.',
    );
  }

  /**
   * F10: the response a BOOSTED GET returns carries every declaration again.
   *
   * This is the permanent net for the defect that shipped. The assertion is on
   * the second request rather than on the page build, because the page build
   * carried the declaration even when the mechanism was broken — the caller
   * applied it there and nowhere else.
   *
   * A configuration-mode id resolves to nothing, so the answer is the whole
   * page (F40) and htmx extracts `#island-content` from it. The fall-through
   * is therefore load-bearing rather than incidental: it is what re-runs the
   * source and re-writes the declaration.
   */
  public function testBoostedGetCarriesEveryDeclarationAgain(): void {
    $response = $this->boostedGet(ConfiguredIslandPageController::CONTENT_ID);
    $html = (string) $response->getContent();

    self::assertSame(200, $response->getStatusCode());
    self::assertStringContainsString(
      '<html',
      $html,
      'A configured island is not addressable, so the boosted GET is answered with the page (F40).',
    );

    // Both containers, both declarations, on the response that REPLACES them.
    self::assertSame(
      self::RIDES_ALONE,
      $this->declarationAttributes($html, ConfiguredIslandPageController::CONTENT_ID),
      'The swapped container carries its own declaration, so the next click is boosted too.',
    );
    self::assertSame(
      self::RIDES_ALONG,
      $this->declarationAttributes($html, ConfiguredIslandPageController::RAIL_ID),
    );

    // Once each: two elements with one id is the observable form of the nesting
    // defect that a missing `hx-select` produces.
    foreach ([ConfiguredIslandPageController::CONTENT_ID, ConfiguredIslandPageController::RAIL_ID] as $id) {
      self::assertSame(1, substr_count($html, 'id="' . $id . '"'), $id . ' appears once.');
    }
  }

  /**
   * The boosted answer contains no out-of-band fragment at all (D3).
   *
   * The other side of the same claim: not only does the content island decline
   * to ask for the rail, the answer to a tab-shaped request smuggles none in.
   * `hx-swap-oob` is the only marker that would put a second fragment into the
   * document, and there is none.
   */
  public function testTheBoostedAnswerShipsNoOutOfBandFragment(): void {
    $html = (string) $this->boostedGet(ConfiguredIslandPageController::CONTENT_ID)->getContent();

    self::assertStringNotContainsString('hx-swap-oob', $html);
  }

  /**
   * Every Twig template the island module ships, excluding its test fixtures.
   *
   * A recursive scan rather than a `templates/` glob: the claim is that NO
   * island ships a template, and a template put beside a plugin class would
   * satisfy a directory check while breaking the property. The fixtures are
   * excluded because they are not shipped — they exist only under `tests/`.
   *
   * @return array<string>
   *   Paths relative to the module root, sorted.
   */
  private function shippedTemplates(): array {
    $root = dirname(__DIR__, 3);
    $found = [];
    $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root));
    foreach ($iterator as $file) {
      $path = (string) $file;
      if (!str_ends_with($path, '.html.twig') || str_contains($path, '/tests/')) {
        continue;
      }
      $found[] = substr($path, strlen($root) + 1);
    }
    sort($found);
    return $found;
  }

  /**
   * A page build of the fixture route, as HTML.
   */
  private function renderedPage(): string {
    return (string) $this->container->get('http_kernel')
      ->handle(Request::create('/island-test-configured'))
      ->getContent();
  }

  /**
   * A boosted GET of the fixture route, targeting one container.
   *
   * Both headers, because the subscriber requires both: `HX-Boosted` and
   * `HX-Target` alone left the request cacheable while being answered with a
   * fragment, and the page-cache policy keys on `HX-Request`.
   */
  private function boostedGet(string $target): Response {
    $request = Request::create('/island-test-configured');
    $request->headers->set('HX-Request', 'true');
    $request->headers->set('HX-Boosted', 'true');
    $request->headers->set('HX-Target', $target);
    return $this->container->get('http_kernel')->handle($request);
  }

  /**
   * The opening tag of the element carrying one id.
   */
  private function elementOf(string $html, string $html_id): string {
    $matched = preg_match(
      '/<[a-z]+ [^>]*id="' . preg_quote($html_id, '/') . '"[^>]*>/',
      $html,
      $element,
    );
    self::assertSame(1, $matched, sprintf('The response carries an element with id "%s".', $html_id));
    return $element[0];
  }

  /**
   * The `hx-*` attribute NAMES on the element carrying one id, sorted.
   *
   * @return array<string>
   *   Every `data-hx-*` / `hx-*` attribute name on that element.
   */
  private function declarationAttributes(string $html, string $html_id): array {
    preg_match_all('/\s((?:data-)?hx-[a-z-]+)=/', $this->elementOf($html, $html_id), $names);
    $found = $names[1];
    sort($found);
    return $found;
  }

  /**
   * The markup INSIDE the element carrying one id, whitespace-collapsed.
   *
   * The container is a `#type: container`, which renders one `<div>` and its
   * close tag around whatever it was given, plus the newlines the template
   * writes. Collapsing those is what lets the comparison be exact rather than
   * a `assertStringContainsString`, and exact is the claim: "nothing added".
   */
  private function insideOf(string $html, string $html_id): string {
    $open = $this->elementOf($html, $html_id);
    $start = strpos($html, $open);
    self::assertIsInt($start);
    $start += strlen($open);
    $end = strpos($html, '</div>', $start);
    self::assertIsInt($end);
    return trim(preg_replace('/\s+/', ' ', substr($html, $start, $end - $start)) ?? '');
  }

}
