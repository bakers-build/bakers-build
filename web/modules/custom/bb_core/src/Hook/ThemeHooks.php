<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Asset\AssetQueryStringInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Render\Element;

/**
 * Every theme hook this module registers, because there may only be one.
 *
 * `ModuleHandler::invokeAllWith()` throws `Module bb_core should not
 * implement theme more than once` outright, so `hook_theme` is a
 * module-singleton rather than a per-concern hook — which is why this class
 * exists at all. Theme SVG asset URLs are versioned here for the same reason:
 * `file_url_alter` is a module hook.
 */
final class ThemeHooks {

  public function __construct(
    private readonly AssetQueryStringInterface $assetQueryString,
  ) {
  }

  /**
   * Registers this module's theme hooks.
   *
   * @see \Drupal\bb_core\Form\BbCreateDialogFormBase
   *
   * @return array<string, array<string, mixed>>
   *   Theme hook definitions keyed by hook name.
   */
  #[Hook('theme')]
  public function theme(): array {
    return [
      'bb_create_dialog' => [
        'render element' => 'form',
      ],
      // The conductor listing's Load cell, a module template rather than a
      // front-theme component.
      'bb_conductor_utilization' => [
        'variables' => ['label' => '', 'level' => '', 'share' => NULL],
      ],
      // The HTML envelope of every outgoing mail, rendered by
      // \Drupal\bb_core\Plugin\Mail\BbHtmlMail independently of any
      // web theme.
      'bb_email' => [
        'variables' => [
          'subject' => '',
          'paragraphs' => [],
          'langcode' => 'en',
          'logo_src' => '',
        ],
      ],
    ];
  }

  /**
   * Groups complete Drupal widgets for the create-dialog presenter.
   *
   * @param array<string, mixed> $variables
   *   The template variables.
   */
  #[Hook('preprocess_bb_create_dialog')]
  public function preprocessCreateDialog(array &$variables): void {
    $form = &$variables['form'];
    $variables['regions'] = ['lead' => [], 'lines' => [], 'pills' => []];
    $variables['placed'] = ['actions'];
    $variables['lead_label'] = '';
    foreach (Element::children($form, TRUE) as $name) {
      if (!isset($form[$name]['#picker_region'])) {
        continue;
      }
      $region = $form[$name]['#picker_region'];
      if (!isset($variables['regions'][$region])) {
        $region = 'lines';
      }
      $variables['regions'][$region][$name] = $form[$name];
      $variables['placed'][] = $name;
      if ($region === 'lead') {
        $variables['lead_label'] = $form[$name]['#picker_label'];
      }
    }
  }

  /**
   * Versions the theme sprite and logo SVG URLs with the asset query token.
   *
   * Only the four exact bare theme paths are rewritten. Already queried or
   * fragmented URIs, other files, and external addresses pass through.
   *
   * @param string $uri
   *   The file URI, altered in place when it matches a versioned theme SVG.
   */
  #[Hook('file_url_alter')]
  public function fileUrlAlter(string &$uri): void {
    if (in_array($uri, [
      'themes/custom/bb_theme/dist/assets/icons/sprite.svg',
      '/themes/custom/bb_theme/dist/assets/icons/sprite.svg',
      'themes/custom/bb_theme/logo-wordmark.svg',
      '/themes/custom/bb_theme/logo-wordmark.svg',
    ], TRUE)) {
      $uri .= '?v=' . $this->assetQueryString->get();
    }
  }

}
