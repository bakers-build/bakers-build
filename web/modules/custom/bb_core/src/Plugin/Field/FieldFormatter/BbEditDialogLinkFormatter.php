<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Form\OverlayTrigger;

/**
 * The value as a link that opens the entity's edit form in the dialog.
 *
 * For entities without a page of their own: the list row is where they are
 * edited. Without update access the value is plain text; without JavaScript
 * the link opens the edit form as a page.
 */
#[FieldFormatter(
  id: 'bb_edit_dialog_link',
  label: new TranslatableMarkup('[bakers.build] Edit in dialog'),
  field_types: ['string'],
)]
final class BbEditDialogLinkFormatter extends FormatterBase {

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $entity = $items->getEntity();
    $url = !$entity->isNew() && $entity->hasLinkTemplate('edit-form') ? $entity->toUrl('edit-form') : NULL;
    $access = $url?->access(return_as_object: TRUE);
    $elements = [];
    foreach ($items as $delta => $item) {
      $value = $item->get('value')->getValue();
      $elements[$delta] = $url !== NULL && $access?->isAllowed()
        ? [
          '#type' => 'link',
          '#title' => $value,
          '#url' => $url,
          '#attributes' => OverlayTrigger::attributes($url),
        ]
        : ['#plain_text' => $value];
    }
    // The dialog returns to the list it was opened from.
    $cacheability = (new CacheableMetadata())->addCacheContexts(['url']);
    if ($access !== NULL) {
      $cacheability->addCacheableDependency($access);
    }
    $cacheability->applyTo($elements);
    return $elements;
  }

}
