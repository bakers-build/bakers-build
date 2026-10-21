<?php

declare(strict_types=1);

namespace Drupal\bb_core\Element;

use Drupal\Core\Render\Attribute\FormElement;
use Drupal\Core\Render\Element\Textarea;

/**
 * A textarea with a Markdown formatting toolbar.
 *
 * Renders `bb_theme:form_rich_text` through `textarea--bakers-markdown`; the
 * suggestion falls back to `textarea` in a theme without that template. Value
 * handling is core's textarea, so the submitted value is the textarea text.
 *
 * Usage example:
 * @code
 * $form['body'] = [
 *   '#type' => 'bb_markdown',
 *   '#title' => $this->t('Body'),
 * ];
 * @endcode
 */
#[FormElement('bb_markdown')]
final class BbMarkdown extends Textarea {

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The element's default properties.
   */
  public function getInfo(): array {
    return ['#theme' => 'textarea__bb_markdown'] + parent::getInfo();
  }

}
