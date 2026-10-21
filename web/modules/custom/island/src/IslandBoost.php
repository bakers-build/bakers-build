<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Security\TrustedCallbackInterface;

/**
 * Declares, on one container, which islands a link inside it should render.
 *
 * It writes no attribute itself; core's Htmx does. One array of island ids
 * feeds both `hx-select-oob` and `hx-headers`, because htmx merges
 * `hx-headers` across ancestors but `hx-select-oob` is closest-wins, so two
 * separate declarations would silently drift once nested.
 *
 * `applyTo()` reads the container's id from the build, e.g.
 * `IslandBoost::to('#island-tasks-content')->applyTo($wrapper)` for a rail
 * whose link also renders the content island.
 */
final class IslandBoost implements TrustedCallbackInterface {

  /**
   * The request header carrying the extra islands the client asked for.
   */
  public const string ALSO_HEADER = 'X-Island-Also';

  /**
   * Extra island html ids beyond the container's own, in declaration order.
   *
   * @var string[]
   */
  private array $also = [];

  private function __construct(
    private readonly ?string $target,
  ) {}

  /**
   * Boosts a container's links towards one swap target.
   *
   * The two-letter name is the point rather than an oversight. The call site
   * reads `IslandBoost::to('#island-tasks-content')`, and the cheapest
   * mitigation this class offers against the nesting trap is a declaration
   * short enough to write correctly without thinking about it.
   *
   * @param string|null $target
   *   A CSS selector for the container the links replace. NULL targets the
   *   boosted container itself, which is the case that declares nothing out of
   *   band: an island is already the main fragment and cannot ride along with
   *   itself.
   *
   * @SuppressWarnings("PHPMD.ShortMethodName")
   */
  public static function to(?string $target = NULL): self {
    return new self($target);
  }

  /**
   * Declares a further island that must be re-rendered with every such link.
   *
   * The common case needs this never: a container targeting something else
   * already declares itself. This exists for the rarer case of a container
   * naming a THIRD island.
   *
   * @param string ...$island_ids
   *   Island html ids, without the leading '#'.
   */
  public function also(string ...$island_ids): self {
    foreach ($island_ids as $island_id) {
      $this->also[] = $island_id;
    }
    return $this;
  }

  /**
   * Writes the declaration onto a container build.
   *
   * @param array $build
   *   A render array carrying `#attributes['id']` — the island wrapper.
   */
  public function applyTo(array &$build): void {
    $own_id = (string) ($build['#attributes']['id'] ?? '');
    if ($own_id === '') {
      throw new \LogicException('IslandBoost::applyTo() needs the container\'s own id in #attributes, and the build carries none.');
    }

    $ids = $this->also;
    if ($this->target !== NULL) {
      // The container rides along with its own link: it is not the fragment
      // being targeted, so it has to be named to be re-rendered.
      array_unshift($ids, $own_id);
    }
    $ids = array_values(array_unique($ids));

    $target_selector = $this->target ?? '#' . $own_id;
    $htmx = (new Htmx())
      ->boost()
      ->target($target_selector)
      // Without a selector htmx swaps the whole <body> into the island
      // whenever the server answers with the ordinary page (an unrecognised
      // island id). Correct on both paths; lets an island exist without a
      // host provider.
      ->select($target_selector)
      // A boosted element always defaults to innerHTML, which would swap the
      // wrapper into itself.
      // ignoreTitle stays FALSE: this is a navigation and the title moves with
      // it, the same reading IslandPluginBase::linkToRoute() takes.
      ->swap('outerHTML', '', FALSE);

    if ($ids !== []) {
      $htmx->selectOob(array_map(static fn(string $id): string => '#' . $id, $ids));
      $htmx->headers([self::ALSO_HEADER => implode(',', $ids)]);
      // The behavioural half of the nesting guard. It is attached only where a
      // declaration exists, because a container with nothing to lose cannot be
      // the ancestor whose selectors a descendant drops.
      $build['#pre_render'][] = [self::class, 'checkNesting'];
    }

    // Htmx::applyTo() overwrites #cache, so the wrapper's own metadata is
    // captured first and merged back.
    $existing = CacheableMetadata::createFromRenderArray($build);
    $htmx->applyTo($build);
    $existing->merge(CacheableMetadata::createFromRenderArray($build))->applyTo($build);
  }

  /**
   * {@inheritdoc}
   */
  public static function trustedCallbacks(): array {
    return ['checkNesting'];
  }

  /**
   * Pre-render callback: no descendant may drop an ancestor's selector.
   *
   * `hx-select-oob` is closest-wins and does not merge, so a nested
   * declaration replaces its ancestor's whole value. Anything the ancestor
   * named and the descendant did not simply stops being swapped — silently,
   * which is the one remaining failure mode of this design.
   *
   * It fails twice on purpose: `assert()` throws where assertions are enabled,
   * which is development and test, and the logger is what reports it on a live
   * site where they are compiled out.
   *
   * Partial by nature: a declaration inside a `#lazy_builder` (placed
   * blocks, BigPipe) is not resolved yet and cannot be seen.
   *
   * @param array $element
   *   The boosted container.
   *
   * @return array
   *   The element, unchanged. This callback observes and never rewrites — a
   *   guard that repaired the markup would hide the authoring mistake it
   *   exists to surface.
   */
  public static function checkNesting(array $element): array {
    $own = self::declaredSelectors($element);
    if ($own === []) {
      return $element;
    }
    // Every violation, not the first. An author who nested two declarations
    // has probably nested three, and reporting one at a time turns one mistake
    // into three round trips.
    $violations = [];
    foreach (self::descendantDeclarations($element) as $id => $selectors) {
      $dropped = array_diff($own, $selectors);
      if ($dropped === []) {
        continue;
      }
      $violations[] = sprintf(
        'Nested island boost on "%s" drops the ancestor selector(s) %s. hx-select-oob is closest-wins and does not merge, so those islands would silently stop updating; repeat them with IslandBoost::also().',
        $id,
        implode(', ', $dropped),
      );
    }
    foreach ($violations as $violation) {
      // A live site compiles the assertion below out; the log is what is left
      // there. Fetched statically because this is a render callback with no
      // construction seam, which is why core's own pre-render callbacks do the
      // same.
      // phpcs:ignore DrupalPractice.Objects.GlobalDrupal
      \Drupal::logger('island')->error($violation);
    }
    assert($violations === [], implode(' ', $violations));
    return $element;
  }

  /**
   * The selectors one element declares out of band, if any.
   *
   * @return string[]
   *   CSS selectors, or an empty array when the element declares none.
   */
  private static function declaredSelectors(array $element): array {
    $attributes = $element['#attributes'] ?? [];
    if (!is_array($attributes) && !$attributes instanceof \ArrayAccess) {
      return [];
    }
    $value = (string) ($attributes['data-hx-select-oob'] ?? '');
    if ($value === '') {
      return [];
    }
    return array_values(array_filter(array_map('trim', explode(',', $value))));
  }

  /**
   * Whether an element declares a boost of its own at all.
   *
   * `data-hx-boost` alone is enough, and that is the whole point of asking.
   * IslandBoost::to() with no also-list writes the boost and the target and
   * NEITHER of the two out-of-band declarations — so such a container looks
   * like "declares nothing" to a check that only reads `hx-select-oob`, and is
   * silently exempted. It is not exempt: htmx resolves both attributes with
   * getClosestAttributeValue, so a link inside it is handed the ANCESTOR's
   * `hx-select-oob` and the ancestor's `X-Island-Also` — and a click that
   * should have cost one island costs two. That is acceptance criterion 3
   * broken by nesting, in the direction of rendering too much rather than of
   * going stale, which is why nothing observed it.
   */
  private static function isDeclarationSite(array $element): bool {
    $attributes = $element['#attributes'] ?? [];
    if (!is_array($attributes) && !$attributes instanceof \ArrayAccess) {
      return FALSE;
    }
    // `data-hx-boost="false"` is htmx's idiom for EXEMPTING a subtree, which
    // core's Htmx::boost(FALSE) writes. Such a container makes no boosted
    // request at all, so it cannot drop an ancestor's selector and reporting it
    // would be a false positive on correct markup.
    $boost = (string) ($attributes['data-hx-boost'] ?? '');
    return !in_array($boost, ['', 'false'], TRUE)
      || (string) ($attributes['data-hx-select-oob'] ?? '') !== '';
  }

  /**
   * Every descendant declaration in an element's own subtree.
   *
   * @return array<string, string[]>
   *   Selector lists, keyed by the declaring element's html id. A declaration
   *   site with no selectors of its own maps to an empty list rather than being
   *   skipped, so the caller reports it as dropping everything the ancestor
   *   named — which is exactly what htmx will do to it.
   */
  private static function descendantDeclarations(array $element): array {
    $found = [];
    foreach ($element as $key => $child) {
      if (!is_array($child) || (is_string($key) && str_starts_with($key, '#'))) {
        continue;
      }
      if (self::isDeclarationSite($child)) {
        $attributes = $child['#attributes'] ?? [];
        $found[(string) ($attributes['id'] ?? '(no id)')] = self::declaredSelectors($child);
      }
      $found += self::descendantDeclarations($child);
    }
    return $found;
  }

}
