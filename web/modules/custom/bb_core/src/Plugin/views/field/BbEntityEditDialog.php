<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\field;

use Drupal\bb_core\Form\OverlayTrigger;
use Drupal\Component\Utility\Html;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\EntityLinkEdit;
use Drupal\views\ResultRow;

/**
 * The row's label, linked to its edit form, which opens in the shell dialog.
 *
 * The plain `href` stays the full-page edit form for a browser without
 * JavaScript; the htmx attributes fetch it as the dialog instead.
 */
#[ViewsField('bb_entity_edit_dialog')]
final class BbEntityEditDialog extends EntityLinkEdit {

  /**
   * {@inheritdoc}
   */
  protected function getUrlInfo(ResultRow $row) {
    $url = parent::getUrlInfo($row);
    return $url?->setOption('attributes', OverlayTrigger::attributes($url));
  }

  /**
   * {@inheritdoc}
   */
  protected function renderLink(ResultRow $row) {
    parent::renderLink($row);
    return Html::escape((string) $this->getEntity($row)?->label());
  }

}
