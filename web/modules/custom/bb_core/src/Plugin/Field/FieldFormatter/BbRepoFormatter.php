<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Renders a bb_repo field as plain text showing the URL and default branch.
 *
 * Output format: "<url> (<default_branch>)" — the branch suffix is omitted
 * when no default branch has been stored.
 */
#[FieldFormatter(
  id: 'bb_repo',
  label: new TranslatableMarkup('bakers.build repository'),
  field_types: ['bb_repo'],
)]
final class BbRepoFormatter extends FormatterBase {

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $elements = [];
    foreach ($items as $delta => $item) {
      $value = $item->getValue();
      $url = (string) ($value['url'] ?? '');
      $default_branch = (string) ($value['default_branch'] ?? '');
      $parts = array_filter([
        $url,
        $default_branch !== '' ? '(' . $default_branch . ')' : NULL,
      ]);
      $elements[$delta] = ['#plain_text' => implode(' ', $parts)];
    }
    return $elements;
  }

}
