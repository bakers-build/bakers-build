<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Editor;

use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Render\RendererInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\editor\Attribute\Editor as EditorAttribute;
use Drupal\editor\Entity\Editor;
use Drupal\editor\Plugin\EditorBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The Markdown toolbar as a text editor, bound to a format by editor config.
 *
 * The toolbar is `bb_theme:form_rich_text`, rendered here with a placeholder
 * id; the `Drupal.editors.bb_markdown` adapter (form_rich_text.src.js, in
 * bb_theme/global) wraps the real textarea in it. The adapter ships in the
 * theme's global library because body forms arrive as htmx fragments, so
 * getLibraries() attaches nothing. The editor only edits plain text, so it is
 * XSS-safe and filters nothing.
 */
#[EditorAttribute(
  id: 'bb_markdown',
  label: new TranslatableMarkup('bakers.build Markdown toolbar'),
  supports_content_filtering: FALSE,
  supports_inline_editing: FALSE,
  is_xss_safe: TRUE,
  supported_element_types: ['textarea', 'bb_markdown'],
)]
final class BbMarkdown extends EditorBase implements ContainerFactoryPluginInterface {

  /**
   * The id the adapter swaps for the real textarea's.
   */
  public const PLACEHOLDER_ID = 'bakers-markdown-placeholder';

  /**
   * Renders the toolbar markup.
   */
  private RendererInterface $renderer;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = new static($configuration, $plugin_id, $plugin_definition);
    $instance->renderer = $container->get('renderer');
    return $instance;
  }

  /**
   * {@inheritdoc}
   *
   * @return array{toolbar: string}
   *   The rendered control, around a placeholder textarea.
   */
  // phpcs:ignore Drupal.NamingConventions.ValidFunctionName.ScopeNotCamelCaps -- core's EditorPluginInterface name.
  public function getJSSettings(Editor $editor): array {
    $control = [
      '#type' => 'component',
      '#component' => 'bb_theme:form_rich_text',
      '#props' => ['id' => self::PLACEHOLDER_ID],
    ];
    return ['toolbar' => (string) $this->renderer->renderInIsolation($control)];
  }

  /**
   * {@inheritdoc}
   *
   * @return list<string>
   *   None: the adapter is in bb_theme/global.
   */
  public function getLibraries(Editor $editor): array {
    return [];
  }

}
