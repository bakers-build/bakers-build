<?php

declare(strict_types=1);

namespace Drupal\bb_addon;

use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * The Addons overlay's addresses and its opening htmx attributes.
 */
final class AddonOverlayUrls {

  /**
   * The overlay of one addon (or the first) as a plain page.
   */
  public static function overlay(BbTicketInterface $ticket, string $addon = ''): Url {
    return Url::fromRoute('bb_addon.overlay', $ticket->toUrl()->getRouteParameters() + ['addon_name' => $addon]);
  }

  /**
   * Swaps the whole card in place on a tab switch.
   *
   * A tab switch re-fetches tabs and panel together, so the active tab and
   * the shown addon always agree (BB-661).
   *
   * Drupal core's `drupal_htmx` main-content-only wrapper format
   * (`onlyMainContent()`) strips the page chrome around the controller's
   * render array, the same mechanism the panel's own self-poll already uses.
   *
   * @return array<string, string>
   *   The `data-hx-*` attributes.
   */
  public static function cardAttributes(BbTicketInterface $ticket, string $addon, string $cardId): array {
    $selector = '#' . $cardId;
    $attributes = (new Htmx())->get(self::overlay($ticket, $addon))
      ->onlyMainContent()->select($selector)->target($selector)->swap('outerHTML')
      ->getAttributes()->toArray();
    return array_map('strval', $attributes);
  }

}
