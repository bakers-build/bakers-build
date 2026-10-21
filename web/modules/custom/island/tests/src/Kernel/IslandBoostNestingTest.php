<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\island\IslandBoost;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use Psr\Log\AbstractLogger;

/**
 * Tests the nesting guard (BB-408 D8, behavioural half).
 *
 * The htmx library takes `hx-select-oob` closest-wins: a nested declaration
 * replaces its ancestor's whole value rather than merging with it. An inner
 * container that omits one of its ancestor's selectors therefore silently
 * stops updating that island — no error, no warning, just an island that
 * quietly goes stale. The contract's structural half keeps the attribute to
 * one author; this is the other half, because the single-source rule still
 * permits two nested IslandBoost calls.
 *
 * The guard is deliberately not a documented convention. A trap that fires only
 * when somebody remembers to write the fixture guards nothing.
 */
#[Group('island')]
final class IslandBoostNestingTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'island'];

  /**
   * Everything the island logger channel was told during one test.
   *
   * An ArrayObject rather than an array property, because the collecting
   * logger is an anonymous class and has to share the sink by identity: a
   * plain array would be copied into it on construction and the test would
   * read back an empty one.
   *
   * @var \ArrayObject<int, string>
   */
  private \ArrayObject $logged;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->logged = new \ArrayObject();
  }

  /**
   * Registers a logger that records the island channel into $this->logged.
   */
  private function captureLog(): void {
    $sink = $this->logged;
    $logger = new class($sink) extends AbstractLogger {

      public function __construct(
        private readonly \ArrayObject $sink,
      ) {}

      /**
       * {@inheritdoc}
       */
      public function log($level, string|\Stringable $message, array $context = []): void {
        $this->sink->append((string) $message);
      }

    };
    $this->container->get('logger.factory')->addLogger($logger);
  }

  /**
   * An outer rail with an inner boosted container of the caller's choosing.
   */
  private function nestedBuild(IslandBoost $inner): array {
    $build = [
      '#type' => 'container',
      '#attributes' => ['id' => 'island-tasks-chrome'],
      'inner' => [
        '#type' => 'container',
        '#attributes' => ['id' => 'island-tasks-nested'],
      ],
    ];
    $inner->applyTo($build['inner']);
    IslandBoost::to('#island-tasks-content')->applyTo($build);
    return $build;
  }

  /**
   * A nested declaration that drops an ancestor's selector must fail.
   */
  public function testNestedDeclarationDroppingAnAncestorSelectorFails(): void {
    $this->captureLog();
    // The inner container declares only itself, which replaces — rather than
    // extends — the rail's '#island-tasks-chrome'.
    $build = $this->nestedBuild(IslandBoost::to('#island-tasks-content'));

    try {
      $this->container->get('renderer')->renderInIsolation($build);
      $this->fail('Rendering a nested declaration that drops an ancestor selector should have failed.');
    }
    catch (\AssertionError $error) {
      $this->assertStringContainsString('#island-tasks-chrome', $error->getMessage());
      $this->assertStringContainsString('island-tasks-nested', $error->getMessage());
    }

    // The production half: assertions are compiled out on a live site, so the
    // logger is the only thing that reports this there.
    $this->assertNotEmpty($this->logged->getArrayCopy());
    $this->assertStringContainsString('#island-tasks-chrome', implode("\n", $this->logged->getArrayCopy()));
  }

  /**
   * A nested declaration that repeats its ancestor's selectors is accepted.
   *
   * Without this case the guard is only proved to fire, not proved to be
   * usable — a check that rejects correct markup as well is not a guard.
   */
  public function testNestedDeclarationRepeatingItsAncestorPasses(): void {
    $this->captureLog();
    $build = $this->nestedBuild(
      IslandBoost::to('#island-tasks-content')->also('island-tasks-chrome'),
    );

    $html = (string) $this->container->get('renderer')->renderInIsolation($build);

    $this->assertStringContainsString('island-tasks-nested', $html);
    $this->assertSame([], $this->logged->getArrayCopy());
  }

  /**
   * A single boosted container is not its own violation.
   */
  public function testAnUnnestedDeclarationPasses(): void {
    $this->captureLog();
    $build = [
      '#type' => 'container',
      '#attributes' => ['id' => 'island-tasks-chrome'],
      'label' => ['#markup' => 'Rail'],
    ];
    IslandBoost::to('#island-tasks-content')->applyTo($build);

    $html = (string) $this->container->get('renderer')->renderInIsolation($build);

    $this->assertStringContainsString('Rail', $html);
    $this->assertSame([], $this->logged->getArrayCopy());
  }

  /**
   * The walk reaches a grandchild, not only a direct child.
   */
  public function testTheGuardReachesDeeperDescendant(): void {
    $this->captureLog();
    $build = [
      '#type' => 'container',
      '#attributes' => ['id' => 'island-tasks-chrome'],
      'middle' => [
        '#type' => 'container',
        'deep' => [
          '#type' => 'container',
          '#attributes' => ['id' => 'island-tasks-deep'],
        ],
      ],
    ];
    IslandBoost::to('#island-tasks-content')->applyTo($build['middle']['deep']);
    IslandBoost::to('#island-tasks-content')->applyTo($build);

    $this->expectException(\AssertionError::class);
    $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * A nested container that swaps ITSELF is a declaration site too.
   *
   * IslandBoost::to() with no argument targets the container and writes neither
   * `hx-select-oob` nor `hx-headers` — by design, because an island does not
   * ride along with itself. Nested under a declaring ancestor that is exactly
   * the trap: htmx resolves both attributes with getClosestAttributeValue, so a
   * link inside this container is handed the ANCESTOR's out-of-band list, and a
   * click that should have re-rendered one island re-renders two. The guard
   * used to read `hx-select-oob` alone and therefore exempted precisely the
   * case that cannot declare one.
   */
  public function testNestedSelfSwapIsNotExemptFromTheGuard(): void {
    $this->captureLog();
    $build = $this->nestedBuild(IslandBoost::to());

    try {
      $this->container->get('renderer')->renderInIsolation($build);
      $this->fail('A nested self-swapping container should not be exempt from the nesting guard.');
    }
    catch (\AssertionError $error) {
      $this->assertStringContainsString('#island-tasks-chrome', $error->getMessage());
      $this->assertStringContainsString('island-tasks-nested', $error->getMessage());
    }

    $this->assertStringContainsString('#island-tasks-chrome', implode("\n", $this->logged->getArrayCopy()));
  }

  /**
   * An unboosted descendant is still not a declaration site.
   *
   * The widened rule must not become "every child is a violation": a plain
   * container inside a boosted one declares nothing, inherits everything, and
   * is exactly what the design expects the markup to be full of.
   */
  public function testPlainDescendantIsNotFlagged(): void {
    $this->captureLog();
    $build = [
      '#type' => 'container',
      '#attributes' => ['id' => 'island-tasks-chrome'],
      'inner' => [
        '#type' => 'container',
        '#attributes' => ['id' => 'island-tasks-plain'],
        'label' => ['#markup' => 'Entry'],
      ],
    ];
    IslandBoost::to('#island-tasks-content')->applyTo($build);

    $html = (string) $this->container->get('renderer')->renderInIsolation($build);

    $this->assertStringContainsString('Entry', $html);
    $this->assertSame([], $this->logged->getArrayCopy());
  }

}
