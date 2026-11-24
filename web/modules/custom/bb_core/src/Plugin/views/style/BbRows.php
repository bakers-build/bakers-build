<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\style;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\views\Attribute\ViewsStyle;
use Drupal\views\Plugin\views\style\StylePluginBase;

/**
 * Arranges rendered entity rows as one `bb_theme:list`.
 *
 * The row plugin renders each result as its entity in a row view mode, so
 * the row's look lives on the entity; this style only hands the rows to the
 * theme's `views-view-bb-rows.html.twig`, which puts them in the list's
 * `rows` slot.
 */
#[ViewsStyle(
  id: 'bb_rows',
  title: new TranslatableMarkup('bakers.build rows'),
  help: new TranslatableMarkup('Lists the rendered rows, one entity each.'),
  theme: 'views_view_bb_rows',
  display_types: ['normal'],
)]
final class BbRows extends StylePluginBase {

  /**
   * {@inheritdoc}
   */
  protected $usesRowPlugin = TRUE;

  /**
   * {@inheritdoc}
   */
  protected $usesGrouping = FALSE;

  /**
   * {@inheritdoc}
   */
  protected $usesRowClass = FALSE;

}
