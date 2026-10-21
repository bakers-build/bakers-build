<?php

declare(strict_types=1);

namespace Drupal\island;

/**
 * Builds the stable island wrapper element.
 */
final class IslandWrapper {

  /**
   * The htmx settings every page carrying an island needs.
   *
   * Turns off `scrollIntoViewOnBoost` through `<meta name="htmx-config">`,
   * which htmx reads itself.
   */
  private const HTMX_CONFIG = '{"scrollIntoViewOnBoost":false}';

  /**
   * Wraps island content in its stable container.
   *
   * Every island container comes from here, so the boost declaration is
   * applied here too and swapped fragments keep it.
   *
   * @param string $html_id
   *   The island HTML id (IslandInterface::getHtmlId()).
   * @param array $content
   *   The island content render array.
   * @param bool $oob
   *   TRUE to mark the fragment for HTMX out-of-band swap.
   * @param \Drupal\island\IslandBoost|null $boost
   *   What the island declares about the links inside this container. NULL
   *   declares nothing.
   * @param string[] $events
   *   The island events this island is subscribed to. A response announcing
   *   one of them in HX-Trigger re-renders it in the browser
   *   (island.events.js), as a server dispatch would on the server.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public static function wrap(string $html_id, array $content, bool $oob = FALSE, ?IslandBoost $boost = NULL, array $events = []): array {
    $attributes = ['id' => $html_id];
    if ($oob) {
      $attributes['hx-swap-oob'] = 'outerHTML';
    }
    if ($events !== []) {
      $attributes['data-island-events'] = implode(' ', $events);
    }
    $build = [
      '#type' => 'container',
      '#attributes' => $attributes,
      // A bare `[]` fails `Element::isRenderArray()`, and ui_patterns then
      // drops the whole wrapper, id and all, so a later out-of-band swap has
      // no target. `#markup => ''` renders nothing but keeps the container.
      'content' => $content === [] ? ['#markup' => ''] : $content,
      // Attached here rather than from hook_page_attachments(), which would
      // reach every admin page in the product for no reason. Attachments
      // bubble and the entry is KEYED, so a page carrying five islands gets it
      // once and a page carrying none gets nothing.
      '#attached' => [
        // Attached by the container, so islands placed through a ui_patterns
        // source also get the behaviour shim.
        'library' => ['island/base'],
        'html_head' => [
          [
            [
              '#tag' => 'meta',
              '#attributes' => ['name' => 'htmx-config', 'content' => self::HTMX_CONFIG],
            ],
            'island_htmx_config',
          ],
        ],
      ],
    ];
    // Last, and on the container the caller is about to receive: applyTo()
    // reads the id out of #attributes, so the author never repeats it, and an
    // out-of-band fragment keeps both halves — the hx-swap-oob marker that
    // gets it into the document and the declaration the NEXT click needs.
    $boost?->applyTo($build);
    return $build;
  }

}
