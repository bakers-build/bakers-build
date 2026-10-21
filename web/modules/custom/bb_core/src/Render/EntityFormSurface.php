<?php

declare(strict_types=1);

namespace Drupal\bb_core\Render;

/**
 * Frames a full-page entity form the way a designed screen is framed.
 *
 * Workspace/user/team/project settings arrive as the form itself, with no
 * canvas of their own. Wrapping here — before HtmlRenderer pre-renders the
 * controller result to extract a title — means a direct visit and a boosted
 * visit wrap the same live form, not one live form and one HTML string.
 */
final class EntityFormSurface {

  /**
   * Wraps a form in canvas + zone. The heading is a shell island.
   *
   * @param array<string, mixed> $form
   *   The live form render array.
   *
   * @return array<string, mixed>
   *   A canvas component build.
   */
  public static function wrap(array $form): array {
    $surface = [
      '#type' => 'component',
      '#component' => 'bb_theme:canvas',
      '#slots' => [
        'main' => [
          '#type' => 'component',
          '#component' => 'bb_theme:zone',
          '#props' => ['inset' => 'none'],
          '#slots' => [
            'content' => $form,
          ],
        ],
      ],
    ];
    if (isset($form['#title'])) {
      $surface['#title'] = $form['#title'];
    }
    return $surface;
  }

  /**
   * Whether a render array is already this surface.
   *
   * @param array<string, mixed> $content
   *   Controller result or island content.
   */
  public static function isFramed(array $content): bool {
    if (($content['#type'] ?? '') === 'component' && ($content['#component'] ?? '') === 'bb_theme:canvas') {
      return TRUE;
    }
    $markup = (string) ($content['#markup'] ?? '');
    return str_contains($markup, 'data-canvas-region')
      || str_contains($markup, 'data-page-header');
  }

}
