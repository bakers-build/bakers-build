<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\views\Views;

/**
 * Renders a list display and asserts each row is one link to its detail.
 */
trait ListRowLinkTestTrait {

  /**
   * Renders a view display in the product theme.
   *
   * @param string $view_id
   *   The view.
   * @param string $display_id
   *   The display.
   * @param list<string> $args
   *   The contextual arguments.
   */
  protected function renderListDisplay(string $view_id, string $display_id, array $args): string {
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $view = Views::getView($view_id);
    self::assertNotNull($view);
    $build = $view->preview($display_id, $args);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Each row holds one link, its detail, and no control of its own.
   *
   * @param string $html
   *   The rendered list.
   * @param list<string> $hrefs
   *   The expected detail paths, one per row, in any order.
   */
  protected function assertRowsLinkOnlyToTheirDetail(string $html, array $hrefs): void {
    $rows = [];
    foreach (array_slice(preg_split('/<(?:li data-list-item|tr[^>]*class="[^"]*table__row)/', $html) ?: [], 1) as $row) {
      $row = explode('</li>', explode('</tr>', $row)[0])[0];
      preg_match_all('/<a\s[^>]*href="([^"]*)"/', $row, $links);
      self::assertCount(1, $links[1], 'A row holds exactly one link.');
      self::assertStringNotContainsString('<button', $row, 'A row holds no button.');
      self::assertStringNotContainsString('data-action-menu', $row, 'A row holds no action menu.');
      $rows[] = html_entity_decode($links[1][0]);
    }
    self::assertEqualsCanonicalizing($hrefs, $rows);
  }

}
