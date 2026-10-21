<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Plugin\Validation\Constraint\BbWorkspaceSlugConstraint;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Guards the reserved-slug list against the live route collection (V2).
 *
 * BB-350 D1 puts a variable segment at the site root, which only works while
 * no workspace slug can shadow a static root segment some module owns. The
 * reserved list in BbWorkspaceSlugConstraint is hand-maintained and can
 * therefore drift; this test is the anti-drift mechanism. It builds the real
 * router from the enabled modules — no fixture list of paths — and asserts that
 * every static first path segment is either reserved or structurally incapable
 * of being a slug (it fails the slug pattern, so the constraint rejects it
 * before the reserved list is ever consulted).
 *
 * KNOWN LIMIT, stated rather than papered over: a kernel test's router only
 * carries the routes of the modules this test enables. The list below mirrors
 * the modules a recipe-test install enables that expose routes, so it covers
 * this product's own surface — but a contrib module added later and NOT added
 * here contributes routes this test never sees. The floor assertion below is
 * what keeps the check from silently degrading to nothing when the module list
 * rots; full coverage of an arbitrary site's router is only reachable from a
 * browser-level check, which this project does not run through PHPUnit.
 *
 * Two measured gaps, recorded so nobody rediscovers them as bugs:
 * - `display_builder` cannot be enabled in a kernel test, so the `/api/...`
 *   segment it owns is never seen here. It is in RESERVED regardless, taken
 *   from the live router of a provisioned site.
 * - `/sites/...` (image style derivatives) is built from the public files
 *   directory, which is `vfs:` under a kernel test and `sites` on a real one.
 *   `sites` is in RESERVED; it is deliberately not in the floor below, because
 *   asserting it here would assert a property of the test harness.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ReservedSlugCoverageTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'field', 'filter', 'file', 'image', 'link', 'options',
    'text', 'toolbar', 'update', 'views', 'block', 'breakpoint', 'path_alias',
    'serialization', 'basic_auth', 'jsonapi', 'consumers', 'simple_oauth',
    'entity', 'state_machine', 'og', 'ui_icons', 'views_autocomplete_filters',
    'bb_core',
  ];

  /**
   * Static root segments this test must actually observe in the router.
   *
   * A floor, not the expectation: if the router stops yielding these the module
   * list above has rotted and the coverage assertion has quietly stopped
   * checking anything. Each one is a segment a real module contributes.
   *
   * @var array<string>
   */
  private const EXPECTED_FLOOR = [
    'admin', 'user', 'batch', 'block-category', 'cron', 'filter', 'file',
    'group', 'jsonapi', 'oauth', 'session', 'system', 'toolbar', 'ui-icons',
    'views', 'views-autocomplete-filters',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Every static root segment the live router exposes is covered.
   */
  public function testReservedListCoversEveryStaticRootSegment(): void {
    $segments = $this->staticRootSegments();

    foreach (self::EXPECTED_FLOOR as $expected) {
      self::assertContains(
        $expected,
        $segments,
        sprintf(
          'The router no longer exposes "/%s". The module list of this test has rotted and the coverage assertion below is no longer checking what it claims to.',
          $expected,
        ),
      );
    }

    $uncovered = [];
    foreach ($segments as $segment) {
      if (in_array($segment, BbWorkspaceSlugConstraint::RESERVED, TRUE)) {
        continue;
      }
      // A segment that cannot pass the slug pattern can never be claimed as a
      // slug in the first place, so it needs no reservation.
      if (preg_match(BbWorkspaceSlugConstraint::PATTERN, $segment) !== 1) {
        continue;
      }
      $uncovered[] = $segment;
    }

    self::assertSame(
      [],
      $uncovered,
      sprintf(
        'These static root path segments can be claimed as a workspace slug and would shadow an existing route: %s. Add them to BbWorkspaceSlugConstraint::RESERVED.',
        implode(', ', $uncovered),
      ),
    );
  }

  /**
   * Returns every static first path segment in the live route collection.
   *
   * @return array<string>
   *   Lowercased segments, deduplicated. Routes whose first segment is a route
   *   parameter are skipped: they carry no static claim on the root.
   */
  private function staticRootSegments(): array {
    $segments = [];
    foreach ($this->container->get('router.route_provider')->getAllRoutes() as $route) {
      $path = ltrim($route->getPath(), '/');
      if ($path === '') {
        continue;
      }
      $first = explode('/', $path)[0];
      if ($first === '' || str_starts_with($first, '{')) {
        continue;
      }
      $segments[mb_strtolower($first)] = TRUE;
    }
    return array_keys($segments);
  }

}
