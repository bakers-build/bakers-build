<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\bb_core\Plugin\views\filter\BbClosedRows;
use Drupal\Tests\UnitTestCase;

/**
 * Resolving the closed position from the query parameter (BB-490).
 *
 * @group bb_core
 */
final class BbClosedRowsTest extends UnitTestCase {

  /**
   * An absent parameter is the default, and the default hides closed rows.
   */
  public function testAbsentParameterIsOpen(): void {
    self::assertSame('open', BbClosedRows::positionFromRequest(NULL));
  }

  /**
   * Each of the three positions round-trips through its own token.
   *
   * @dataProvider positionProvider
   */
  public function testKnownPositions(string $raw, string $expected): void {
    self::assertSame($expected, BbClosedRows::positionFromRequest($raw));
  }

  /**
   * The three tokens and themselves.
   *
   * @return array<string, array{string, string}>
   *   Raw parameter, resolved position.
   */
  public static function positionProvider(): array {
    return [
      'open' => ['open', 'open'],
      'only' => ['only', 'only'],
      'all' => ['all', 'all'],
    ];
  }

  /**
   * An unrecognised value falls back to the default rather than widening.
   *
   * A typo in a pasted link must show the safe view, not the whole history,
   * and must not error.
   *
   * @dataProvider junkProvider
   */
  public function testUnknownValueFallsBackToOpen(string $raw): void {
    self::assertSame('open', BbClosedRows::positionFromRequest($raw));
  }

  /**
   * Values a pasted or hand-edited link can carry.
   *
   * @return array<string, array{string}>
   *   The raw parameter.
   */
  public static function junkProvider(): array {
    return [
      'empty' => [''],
      'legacy numeric' => ['1'],
      'uppercase' => ['ALL'],
      'nonsense' => ['closed-please'],
    ];
  }

  /**
   * The default position offers a clean address for itself.
   *
   * `open` is the ABSENCE of the parameter, so its own link drops the key
   * rather than writing `closed=open` — an untouched listing keeps a clean
   * URL and a pasted link means what it showed.
   */
  public function testOpenLinkDropsTheParameter(): void {
    $items = BbClosedRows::buildItems('/_workspace/acme/tickets', [], 'open');

    self::assertSame('/_workspace/acme/tickets', $items[0]['url']);
    self::assertTrue($items[0]['active']);
    self::assertSame('/_workspace/acme/tickets?closed=only', $items[1]['url']);
    self::assertSame('/_workspace/acme/tickets?closed=all', $items[2]['url']);
    self::assertFalse($items[1]['active']);
    self::assertFalse($items[2]['active']);
  }

  /**
   * The three positions come in BB-282's order with its own labels.
   */
  public function testLabelsAndOrder(): void {
    $items = BbClosedRows::buildItems('/x', [], 'open');

    self::assertSame(['Open', 'Closed', 'All'], array_column($items, 'label'));
  }

  /**
   * Every other query parameter survives the switch (D4).
   *
   * This is what keeps the control combining with the exposed facets instead
   * of resetting them.
   */
  public function testOtherParametersArePreserved(): void {
    $query = ['state' => ['coding'], 'page' => '2', 'closed' => 'only'];
    $items = BbClosedRows::buildItems('/_workspace/acme/tickets', $query, 'only');

    self::assertStringContainsString('state%5B0%5D=coding', $items[2]['url']);
    self::assertStringContainsString('closed=all', $items[2]['url']);
    self::assertTrue($items[1]['active']);
    // The Open link drops the key and keeps the rest.
    self::assertStringNotContainsString('closed=', $items[0]['url']);
    self::assertStringContainsString('state%5B0%5D=coding', $items[0]['url']);
    // The active position's own link is unchanged, so it keeps its page.
    self::assertStringContainsString('page=2', $items[1]['url']);
  }

  /**
   * Switching position drops `page`, since the new result set may not have it.
   */
  public function testPageIsDroppedWhenPositionChanges(): void {
    $query = ['page' => '3', 'closed' => 'only'];
    $items = BbClosedRows::buildItems('/_workspace/acme/tickets', $query, 'only');

    // Open and All change the position away from the active `only`.
    self::assertStringNotContainsString('page=', $items[0]['url']);
    self::assertStringNotContainsString('page=', $items[2]['url']);
    // The active position's own link is unchanged and keeps its page.
    self::assertStringContainsString('page=3', $items[1]['url']);
  }

  /**
   * Drupal's internal AJAX bookkeeping never reaches a pasted link.
   *
   * The control is rendered inside a BEF auto-submit AJAX response, whose
   * request carries `ajax_page_state[...]` keys the widget must not repeat
   * into its own hrefs.
   */
  public function testAjaxPageStateParametersAreStripped(): void {
    $query = [
      'closed' => 'open',
      'ajax_page_state' => [
        'theme' => 'bb_theme',
        'theme_token' => 'abc123',
        'libraries' => 'core/drupal',
      ],
      'ajax_page_state_something' => 'x',
      'state' => ['coding'],
    ];
    $items = BbClosedRows::buildItems('/_workspace/acme/tickets', $query, 'open');

    foreach ($items as $item) {
      self::assertStringNotContainsString('ajax_page_state', $item['url']);
    }
    self::assertStringContainsString('state%5B0%5D=coding', $items[1]['url']);
  }

  /**
   * Drupal's other internal parameters are stripped for the same reason.
   *
   * `ajax_page_state` was only the family the review happened to observe in a
   * failure artifact. `destination` is the one that matters most: carried into
   * these hrefs it would redirect whoever follows a pasted link away from the
   * listing it was meant to show.
   */
  public function testTheOtherInternalParametersAreStripped(): void {
    $query = [
      '_wrapper_format' => 'drupal_ajax',
      'ajax_form' => '1',
      '_drupal_ajax' => '1',
      'destination' => '/user/login',
      'state' => ['coding'],
    ];
    $items = BbClosedRows::buildItems('/_workspace/acme/tickets', $query, 'open');

    foreach ($items as $item) {
      self::assertStringNotContainsString('_wrapper_format', $item['url']);
      self::assertStringNotContainsString('ajax_form', $item['url']);
      self::assertStringNotContainsString('_drupal_ajax', $item['url']);
      self::assertStringNotContainsString('destination', $item['url']);
      self::assertStringContainsString('state%5B0%5D=coding', $item['url']);
    }
  }

  /**
   * A numeric query key does not take the listing down.
   *
   * PHP casts a numeric array key to int, so `?0=x` reaches the stripping
   * closure as an int. With a `string` type declaration and strict_types that
   * is a TypeError — a white screen anyone could trigger from the address bar.
   */
  public function testNumericQueryKeyIsSurvivable(): void {
    $items = BbClosedRows::buildItems('/_workspace/acme/tickets', ['0' => 'x'], 'open');

    self::assertCount(3, $items);
    self::assertStringContainsString('0=x', $items[0]['url']);
  }

  /**
   * The contextual path is carried, not rebuilt.
   *
   * A project or team listing is the same control on a different address; a
   * rebuilt path would drop the contextual argument and show the whole
   * workspace.
   */
  public function testContextualPathIsCarried(): void {
    $items = BbClosedRows::buildItems('/_workspace/acme/project/apollo/runs', [], 'all');

    foreach ($items as $item) {
      self::assertStringStartsWith('/_workspace/acme/project/apollo/runs', $item['url']);
    }
    self::assertTrue($items[2]['active']);
  }

}
