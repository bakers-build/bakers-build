<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\Core\Cache\CacheableResponseInterface;
use Drupal\island\IslandWrapper;
use Drupal\island_test\GatedHostProvider;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use Psr\Log\AbstractLogger;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Tests the boosted GET answer (BB-408 D3).
 *
 * The server decides nothing here. It renders exactly what the client named in
 * `HX-Target` plus whatever `X-Island-Also` adds, and there is no route
 * anywhere in the answer. Each test below is one column of that claim.
 */
#[Group('island')]
final class IslandGetPathTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'user', 'island', 'island_test'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['system']);
    $this->container->get('theme_installer')->install(['stark']);
    $this->container->get('config.factory')->getEditable('system.theme')->set('default', 'stark')->save();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Issues a request through the real kernel, optionally as an island GET.
   */
  private function request(string $path, ?string $target = NULL, ?string $also = NULL, string $method = 'GET', bool $boosted = TRUE): Response {
    $request = Request::create($path, $method);
    if ($target !== NULL) {
      $request->headers->set('HX-Request', 'true');
      if ($boosted) {
        $request->headers->set('HX-Boosted', 'true');
      }
      $request->headers->set('HX-Target', $target);
    }
    if ($also !== NULL) {
      $request->headers->set('X-Island-Also', $also);
    }
    return $this->container->get('http_kernel')->handle($request);
  }

  /**
   * The island wrapper ids a response contains, in document order.
   *
   * @return string[]
   *   Every id matching the island convention, including repeats — a repeat is
   *   precisely the nesting defect criterion 6 forbids.
   */
  private function islandIds(Response $response): array {
    preg_match_all('/id="(island-[^"]+)"/', (string) $response->getContent(), $matches);
    return $matches[1];
  }

  /**
   * A target and nothing else renders exactly one island.
   *
   * The assertion is the whole SET of rendered ids, not a presence. A presence
   * passes against a response that rendered too much, and rendering too much
   * is exactly what this design exists to stop: a content click that also
   * re-renders the chrome has silently become the every-navigation-renders-
   * the-menu cost the ticket set out to avoid.
   */
  public function testOneTargetAloneRendersExactlyOneIsland(): void {
    $response = $this->request('/island-test', 'island-tasks-task_list');

    $this->assertSame(200, $response->getStatusCode());
    $this->assertSame(['island-tasks-task_list'], $this->islandIds($response));
    $this->assertStringContainsString('list:3', (string) $response->getContent());
  }

  /**
   * The main fragment is not nested inside a second copy of its own wrapper.
   *
   * A boosted element defaults to innerHTML, so the swap target is the wrapper
   * itself and the response must be the wrapper — once. Two wrappers with the
   * same id is the observable form of the nesting defect.
   */
  public function testTheMainFragmentIsNotNestedInsideItsOwnWrapper(): void {
    $html = (string) $this->request('/island-test', 'island-tasks-task_list')->getContent();

    $this->assertSame(1, substr_count($html, 'id="island-tasks-task_list"'));
    $this->assertStringNotContainsString('hx-swap-oob', $html);
  }

  /**
   * A target plus an also-list renders two islands in one response.
   *
   * This is a rail click: the content region is the main fragment and the rail
   * rides along out of band, in ONE HTTP request.
   */
  public function testTargetPlusAnAlsoListRendersTwoIslands(): void {
    $response = $this->request(
      '/island-test',
      'island-tasks-task_list',
      'island-tasks-task_count',
    );
    $html = (string) $response->getContent();

    $this->assertSame(
      ['island-tasks-task_list', 'island-tasks-task_count'],
      $this->islandIds($response),
    );
    // The main fragment carries no out-of-band marker; the peer does.
    $this->assertMatchesRegularExpression('/id="island-tasks-task_count"[^>]*hx-swap-oob="outerHTML"/', $html);
    $this->assertDoesNotMatchRegularExpression('/id="island-tasks-task_list"[^>]*hx-swap-oob/', $html);
    $this->assertStringContainsString('count:3', $html);
  }

  /**
   * An also-list naming the target does not render it twice.
   */
  public function testAnAlsoListNamingTheTargetDoesNotRepeatIt(): void {
    $response = $this->request(
      '/island-test',
      'island-tasks-task_list',
      'island-tasks-task_list,island-tasks-task_count',
    );

    $this->assertSame(
      ['island-tasks-task_list', 'island-tasks-task_count'],
      $this->islandIds($response),
    );
  }

  /**
   * An also-list entry that resolves to nothing is skipped, not an error.
   *
   * The htmx library already treats a missing hx-select-oob selector as
   * optional, so a server refusing the whole response over one stale id would
   * be stricter than the client that asked.
   */
  public function testAnUnresolvableAlsoEntryIsSkipped(): void {
    $response = $this->request(
      '/island-test',
      'island-tasks-task_list',
      'island-tasks-not_an_island',
    );

    $this->assertSame(200, $response->getStatusCode());
    $this->assertSame(['island-tasks-task_list'], $this->islandIds($response));
  }

  /**
   * Without the headers the page is rendered as usual.
   */
  public function testPlainRequestIsUntouched(): void {
    $response = $this->request('/island-test');
    $html = (string) $response->getContent();

    $this->assertSame(200, $response->getStatusCode());
    $this->assertStringContainsString('<html', $html);
    $this->assertSame([], $this->islandIds($response));
  }

  /**
   * An HX-Target that names no island leaves the page alone.
   *
   * The subscriber answers what it can resolve and otherwise gets out of the
   * way. Any other reading would turn every htmx request in the product into
   * an island request.
   */
  public function testAnUnresolvableTargetLeavesThePageAlone(): void {
    $response = $this->request('/island-test', 'some-other-container');
    $html = (string) $response->getContent();

    $this->assertSame(200, $response->getStatusCode());
    $this->assertStringContainsString('<html', $html);
    $this->assertSame([], $this->islandIds($response));
  }

  /**
   * An htmx request that is not boosted belongs to core, not to this.
   *
   * The module's own linkToRoute() links are htmx GETs whose HX-Target names
   * an island, so they are indistinguishable from a boosted click by that pair
   * of headers alone — and answering them here strips the <title> that core's
   * HtmxContentViewSubscriber puts in the fragment, which is a delivered
   * acceptance criterion of the link layer. Found in the browser harness after
   * both title tests went red, and pinned here so it cannot come back
   * unobserved.
   */
  public function testNonBoostedHtmxRequestIsLeftToCore(): void {
    $response = $this->request('/island-test', 'island-tasks-task_list', NULL, 'GET', FALSE);

    $this->assertStringContainsString('<html', (string) $response->getContent());
    $this->assertSame([], $this->islandIds($response));
  }

  /**
   * The attributes of the container carrying one island id, as a set.
   *
   * @return string[]
   *   Every `data-hx-*` / `hx-*` attribute NAME on that element, sorted. The
   *   names alone are the assertion: what a broken swap loses is the whole
   *   declaration, not one value of it.
   */
  private function declarationAttributes(Response $response, string $html_id): array {
    $matched = preg_match(
      '/<[a-z]+ [^>]*id="' . preg_quote($html_id, '/') . '"[^>]*>/',
      (string) $response->getContent(),
      $element,
    );
    if ($matched !== 1) {
      return [];
    }
    preg_match_all('/\s((?:data-)?hx-[a-z-]+)=/', $element[0], $names);
    $found = $names[1];
    sort($found);
    return $found;
  }

  /**
   * The main GET fragment carries the island's own declaration.
   *
   * This is the defect that shipped, and the reason it shipped is that nothing
   * clicked twice. The declaration was applied by the CALLER — the host
   * controller for a page build — so the swapped fragment came back bare and
   * the next click on the swapped container was a full page load. The island
   * is the one author, and every render has to ask it.
   */
  public function testTheMainFragmentCarriesTheIslandsOwnDeclaration(): void {
    $response = $this->request('/island-test', 'island-tasks-rail');

    $this->assertSame(['island-tasks-rail'], $this->islandIds($response));
    $this->assertSame(
      ['data-hx-boost', 'data-hx-headers', 'data-hx-select', 'data-hx-select-oob', 'data-hx-swap', 'data-hx-target'],
      $this->declarationAttributes($response, 'island-tasks-rail'),
    );
    $html = (string) $response->getContent();
    $this->assertStringContainsString('data-hx-target="#island-tasks-task_list"', $html);
    $this->assertStringContainsString('data-hx-swap="outerHTML"', $html);
    $this->assertStringContainsString('data-hx-select-oob="#island-tasks-rail"', $html);
  }

  /**
   * The out-of-band peer carries it too, and that is the motivating case.
   *
   * The rail is what rides along: it is the declaring container, and it
   * arrives out of band. `hx-swap-oob` defaults to `outerHTML`, so the element
   * in the document is REPLACED by this fragment — a bare one silently ends
   * the boosted session after exactly one click.
   */
  public function testTheOutOfBandPeerCarriesTheDeclarationToo(): void {
    $response = $this->request('/island-test', 'island-tasks-task_list', 'island-tasks-rail');

    $this->assertSame(
      ['island-tasks-task_list', 'island-tasks-rail'],
      $this->islandIds($response),
    );
    // Both halves on the same element: the out-of-band marker AND the
    // declaration the next click needs.
    $this->assertSame(
      [
        'data-hx-boost', 'data-hx-headers', 'data-hx-select', 'data-hx-select-oob',
        'data-hx-swap', 'data-hx-target', 'hx-swap-oob',
      ],
      $this->declarationAttributes($response, 'island-tasks-rail'),
    );
    // And an island that declares nothing still gets nothing.
    $this->assertSame([], $this->declarationAttributes($response, 'island-tasks-task_list'));
  }

  /**
   * An island the visitor may not view is not rendered by naming it.
   *
   * The boosted GET is a SECOND render entry point: the page build's own gate
   * is nowhere near it, so without this check any visitor who can reach any
   * page could render any island by putting its id in a header.
   *
   * A denied fragment is skipped exactly the way an unresolvable one is, so the
   * header cannot be used as an existence oracle either: "forbidden" and "no
   * such island" are the same observable answer.
   */
  public function testIslandTheVisitorMayNotViewIsNotRendered(): void {
    $response = $this->request('/island-test', 'island-gated-editors');
    $html = (string) $response->getContent();

    // Falls through to the ordinary page, which is the same answer an
    // unresolvable target gets.
    $this->assertSame(200, $response->getStatusCode());
    $this->assertStringContainsString('<html', $html);
    $this->assertSame([], $this->islandIds($response));
  }

  /**
   * An island restricted to a role the visitor lacks is not rendered.
   *
   * This is the motivating threat, and it is per visitor rather than per site:
   * `editors` is not switched off, it is off FOR THIS VISITOR. That is what an
   * operator's visibility condition is, and it is what the boosted GET used to
   * render straight past.
   *
   * The response's cache CONTEXTS are asserted beside the markup, because tags
   * and contexts fail differently: a missing tag serves stale content, a
   * missing context serves ANOTHER USER's content. The whole point of
   * collecting the access decisions is the second one.
   */
  public function testIslandRestrictedToRoleTheVisitorLacksIsNotRendered(): void {
    // Two placements rather than one reconfigured: the open island is the
    // target and the restricted one rides along in the extra header, so one
    // request shows both the denial and what the denial contributes to the
    // answer's cacheability.
    $response = $this->request(
      '/island-test',
      'island-gated-open',
      'island-gated-editors',
    );

    // The restricted placement is absent, and the rest of the answer stands.
    $this->assertSame(['island-gated-open'], $this->islandIds($response));

    // The decision that removed it depends on the visitor's roles, and the
    // response says so. Tags and contexts fail differently: a missing tag
    // serves stale content, a missing context serves ANOTHER USER's content,
    // and the second is the whole reason the access decisions are collected.
    $this->assertInstanceOf(CacheableResponseInterface::class, $response);
    $this->assertContains('user.roles', $response->getCacheableMetadata()->getCacheContexts());
  }

  /**
   * A forbidden also-entry is skipped, and the rest of the answer stands.
   *
   * The extra header is as attacker-controlled as the target, so the check runs
   * per fragment rather than once on the main one.
   */
  public function testForbiddenAlsoEntryIsSkippedLikeAnUnresolvableOne(): void {
    $response = $this->request(
      '/island-test',
      'island-tasks-task_list',
      'island-gated-editors',
    );

    $this->assertSame(200, $response->getStatusCode());
    $this->assertSame(['island-tasks-task_list'], $this->islandIds($response));
  }

  /**
   * A host that declares no view access renders nothing on this path.
   *
   * The resolver walks every registered provider and is deliberately not
   * scoped to the current route — that scoping would be the route inference
   * criterion 4 forbids. What replaces it is a declaration: a host says who may
   * see its islands, and a host that says nothing is forbidden rather than
   * open, so a new host cannot leak by omission. The page build and the
   * mutation path are untouched; this gate is the boosted GET's alone.
   */
  public function testHostThatDeclaresNoViewAccessRendersNothing(): void {
    $response = $this->request('/island-test', 'island-silent-quiet');
    $html = (string) $response->getContent();

    $this->assertSame(200, $response->getStatusCode());
    $this->assertStringContainsString('<html', $html);
    $this->assertSame([], $this->islandIds($response));
  }

  /**
   * The silent host is reported once per request, not once per named id.
   *
   * The refusal is correct but surprising, so it says something — at debug,
   * because omitting the interface is documented as legitimate rather than
   * broken. What it must not do is say it sixteen times: every entry in the
   * extra header is resolved on its own, so an unguarded log here is a flood
   * vector opened by one anonymous request, which is exactly why the ordinary
   * denial beside it stays silent.
   */
  public function testTheSilentHostIsReportedOncePerRequest(): void {
    $lines = new \ArrayObject();
    $this->container->get('logger.factory')->addLogger(new class($lines) extends AbstractLogger {

      public function __construct(
        private readonly \ArrayObject $sink,
      ) {}

      /**
       * {@inheritdoc}
       */
      public function log($level, string|\Stringable $message, array $context = []): void {
        if (str_contains((string) $message, 'IslandViewAccessInterface')) {
          $this->sink->append((string) $message);
        }
      }

    });

    // One target plus three more ids, all of the interface-less host.
    $this->request(
      '/island-test',
      'island-silent-quiet',
      'island-silent-quiet,island-silent-a,island-silent-b',
    );

    $this->assertCount(1, $lines->getArrayCopy());
  }

  /**
   * A host may deny one island while allowing another.
   *
   * The seam takes the island id, so access is per island rather than per host:
   * a host with a public list and an admin-only counter can say so.
   */
  public function testHostCanDenyOneIslandAndAllowAnother(): void {
    $denied = $this->request('/island-test', 'island-tasks-quiet');
    $this->assertSame([], $this->islandIds($denied));

    $allowed = $this->request('/island-test', 'island-tasks-task_list');
    $this->assertSame(['island-tasks-task_list'], $this->islandIds($allowed));
  }

  /**
   * The answer varies on the access decisions it made.
   *
   * A fragment rendered under a permission check must not be served from a
   * cache to somebody without it. The host's own access result carries the
   * contexts and tags that say so; dropping them would trade a leak by
   * omission for a leak by caching.
   *
   * The ALLOWED decision is the one measured here, deliberately. A denial that
   * forgets its cacheability serves nothing and is caught by the roles test
   * above; an allowance that forgets it is what hands one visitor's answer to
   * the next.
   */
  public function testTheResponseCarriesTheAccessCacheability(): void {
    $response = $this->request('/island-test', 'island-gated-open');

    $this->assertInstanceOf(CacheableResponseInterface::class, $response);
    $this->assertSame(['island-gated-open'], $this->islandIds($response));
    $metadata = $response->getCacheableMetadata();
    $this->assertContains('island_test:gated', $metadata->getCacheTags());
    $this->assertContains('user.roles', $metadata->getCacheContexts());
  }

  /**
   * The also-list is capped, and the excess is dropped rather than refused.
   *
   * The header is client-supplied and every entry costs a resolve, an access
   * check and a render, while the page-cache policy denies the request so none
   * of the work is served from a cache. A cap keeps a cheap header from buying
   * an expensive answer; dropping rather than refusing keeps it consistent with
   * every other unusable id here.
   */
  public function testTheAlsoListIsCapped(): void {
    // Twenty distinct, resolvable, viewable islands, so that neither
    // de-duplication nor the access gate nor an unresolvable id can be what
    // trims the answer — the cap has to be, or this test measures nothing.
    // GatedHostProvider declares them for exactly this: an attacker naming
    // twenty ids is the cheap-header/expensive-answer case the cap exists for.
    $also = [];
    for ($i = 0; $i < GatedHostProvider::WING_COUNT; $i++) {
      $also[] = 'island-gated-wing_' . $i;
    }

    $rendered = $this->islandIds(
      $this->request('/island-test', 'island-tasks-task_list', implode(',', $also)),
    );

    // The main fragment plus exactly MAX_ALSO peers, in declaration order, and
    // the last four dropped.
    $this->assertCount(17, $rendered);
    $this->assertSame('island-tasks-task_list', $rendered[0]);
    $this->assertSame('island-gated-wing_0', $rendered[1]);
    $this->assertSame('island-gated-wing_15', $rendered[16]);
    $this->assertNotContains('island-gated-wing_16', $rendered);
  }

  /**
   * A host claiming an island id with no plugin behind it is a miss.
   *
   * Not a 500. Everything else on this path answers an id it cannot serve by
   * getting out of the way, and an uncaught PluginNotFoundException would make
   * an ordinary boosted click fail where the same page loads fine directly.
   */
  public function testIslandIdWithNoPluginResolvesToNothing(): void {
    $response = $this->request('/island-test', 'island-broken-not_a_plugin');
    $html = (string) $response->getContent();

    $this->assertSame(200, $response->getStatusCode());
    $this->assertStringContainsString('<html', $html);
    $this->assertSame([], $this->islandIds($response));
  }

  /**
   * A boosted request without HX-Request is not answered here.
   *
   * The subscriber's trigger and the page-cache policy have to key on the same
   * requests, or the guard has a hole exactly the width of their difference.
   * Core's isHtmxBoosted() reads `HX-Boosted` and no other header, while the
   * policy denies on `HX-Request` plus `HX-Target` — so `HX-Boosted` and
   * `HX-Target` alone were answered with an island fragment while the request
   * stayed cacheable, and the fragment was stored under the page's own url.
   * Real htmx always sends both headers; requiring both costs nothing and is
   * the half of the fix that lives here.
   */
  public function testBoostedWithoutHxRequestIsNotAnswered(): void {
    $request = Request::create('/island-test');
    $request->headers->set('HX-Boosted', 'true');
    $request->headers->set('HX-Target', 'island-tasks-task_list');
    $response = $this->container->get('http_kernel')->handle($request);

    $this->assertStringContainsString('<html', (string) $response->getContent());
    $this->assertSame([], $this->islandIds($response));
  }

  /**
   * A controller's own 404 survives the island headers.
   *
   * This is why the answer is built at kernel.view. A kernel.request
   * short-circuit would be cheaper and would answer 200 here, where a direct
   * visit answers 404 — and no access check covers that axis.
   */
  public function testControllerNotFoundStill404sUnderTheIslandHeaders(): void {
    $response = $this->request('/island-test-missing', 'island-tasks-task_list');

    $this->assertSame(404, $response->getStatusCode());
    $this->assertSame([], $this->islandIds($response));
  }

  /**
   * The response varies on what the client declared, and on nothing else.
   *
   * Not on HX-Current-URL: the withdrawn mechanism keyed on the origin url
   * because it inferred the answer from the route. This one is told.
   */
  public function testTheResponseVariesOnTheDeclarationOnly(): void {
    $response = $this->request('/island-test', 'island-tasks-task_list', 'island-tasks-task_count');
    // Read off the response's own cacheable metadata rather than the
    // X-Drupal-Cache-Contexts header: that header is only emitted when
    // http.response.debug_cacheability_headers is on, so asserting it here
    // would test the container's debug settings, not the subscriber.
    $this->assertInstanceOf(CacheableResponseInterface::class, $response);
    $contexts = $response->getCacheableMetadata()->getCacheContexts();

    $this->assertContains('headers:HX-Target', $contexts);
    $this->assertContains('headers:X-Island-Also', $contexts);
    $this->assertNotContains('headers:HX-Current-URL', $contexts);
  }

  /**
   * A page carrying an island turns scrollIntoViewOnBoost off (BB-408 D7).
   *
   * Through `<meta name="htmx-config">`, which htmx reads itself — no script
   * of this module's is involved in the setting. Attached from IslandWrapper
   * rather than from hook_page_attachments(), so a page with no island gets
   * nothing; the request below is the plain one, which renders the
   * island_test page and no island at all, and it must therefore NOT carry
   * the meta.
   */
  public function testTheHtmxConfigMetaRidesWithTheIslandAndNotWithoutIt(): void {
    $page = [
      'one' => IslandWrapper::wrap('island-tasks-task_list', ['#markup' => 'a']),
      'two' => IslandWrapper::wrap('island-tasks-task_count', ['#markup' => 'b']),
    ];
    // renderRoot() is what collects bubbled attachments onto the root element;
    // it is the same collection the html response processor turns into <head>.
    $this->container->get('renderer')->renderRoot($page);

    $head = $page['#attached']['html_head'] ?? [];
    $entries = array_values(array_filter(
      $head,
      static fn(array $entry): bool => ($entry[1] ?? '') === 'island_htmx_config',
    ));

    // Two islands contribute two entries and both carry the SAME key. That is
    // what makes the page get one meta element: bubbling concatenates
    // html_head, and the head is built as a map keyed by that second value, so
    // identical keys collapse to one element there. Measured rather than
    // assumed — the first draft of this test asserted one entry here and
    // observed two.
    $this->assertCount(2, $entries);
    $this->assertSame($entries[0], $entries[1]);
    $this->assertSame('meta', $entries[0][0]['#tag']);
    $this->assertSame('htmx-config', $entries[0][0]['#attributes']['name']);
    $this->assertSame('{"scrollIntoViewOnBoost":false}', $entries[0][0]['#attributes']['content']);

    // And a page with no island contributes nothing at all — which is why this
    // is attached from the wrapper rather than from hook_page_attachments().
    $this->assertStringNotContainsString('htmx-config', (string) $this->request('/island-test')->getContent());
  }

  /**
   * The module's own library rides with the container, not with the caller.
   *
   * BB-420: `island/base` used to be attached by the CALLERS — the plugin
   * base's link builders, IslandFormTrait — so an island
   * placed from a ui_patterns source got a container and none of the module's
   * assets. That was invisible while the library was CSS only. It stopped
   * being invisible when the library grew `js/island.behaviors.js`, because
   * the page that has to carry that script is exactly the page a later
   * out-of-band swap lands on, and the shell's overlay island is placed from
   * config rather than built by a plugin.
   *
   * Asserted on the WRAPPER's own build rather than on a rendered page, for
   * the same reason the meta test above renders its own two islands: the
   * claim is about the one place every island container is built.
   */
  public function testTheModuleLibraryRidesWithTheIslandContainer(): void {
    $build = IslandWrapper::wrap('island-tasks-task_list', ['#markup' => 'a']);
    $this->assertContains('island/base', $build['#attached']['library'] ?? []);

    // And a page with no island still gets nothing, which is the property the
    // wrapper-side attachment is chosen for.
    $this->assertStringNotContainsString(
      'island.behaviors.js',
      (string) $this->request('/island-test')->getContent(),
    );
  }

  /**
   * A POST is not this subscriber's business — it is the mutation path's.
   *
   * A mutating request belongs to the matched route's own form, through Form
   * API: an island form posts to its own url, and answering that with a
   * freshly built island would throw its validation errors away. BB-420 Task
   * 10 carved out one exception — an island whose container lives OUTSIDE its
   * route's main content, which Form API never reaches at all — and BB-420
   * Task 24 withdrew the exception by removing the case: such a surface gets a
   * ROUTE now, and its form is main content like everybody else's.
   *
   * So the claim is back to what it was before that carve-out, and stronger
   * than "the fan-out is smaller": a POST comes back as the ORDINARY PAGE. The
   * request names a target AND an extra island, which is the richest
   * declaration a client can make, and neither is honoured.
   */
  public function testPostIsNotAnsweredByTheBoostedPath(): void {
    $response = $this->request('/island-test', 'island-tasks-task_list', 'island-tasks-task_count', 'POST');

    $this->assertStringContainsString('<html', (string) $response->getContent());
    $this->assertSame([], $this->islandIds($response));
  }

}
