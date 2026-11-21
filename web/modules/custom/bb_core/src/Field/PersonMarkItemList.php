<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\file\FileInterface;
use Drupal\image\ImageStyleInterface;
use Drupal\user\UserInterface;

/**
 * An account's mark: `person_initials`, `person_color`, `person_picture`.
 *
 * The one place a person's mark is derived. The `compact` view mode and every
 * person cell read these fields, so a picture shows wherever the person does.
 */
final class PersonMarkItemList extends FieldItemList {

  use ComputedItemListTrait;
  use PersonIdentityTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $account = $this->getEntity();
    if (!$account instanceof UserInterface) {
      return;
    }
    $value = match ($this->getFieldDefinition()->getName()) {
      'person_initials' => $this->personInitials($this->personDisplayName($account)),
      'person_color' => $this->personColor((int) $account->id()),
      default => $this->pictureUrl($account),
    };
    $this->list[0] = $this->createItem(0, $value);
  }

  /**
   * The account's picture through the `avatar` style, or empty.
   */
  private function pictureUrl(UserInterface $account): string {
    if (!$account->hasField('user_picture')) {
      return '';
    }
    $file = $account->get('user_picture')->entity;
    if (!$file instanceof FileInterface) {
      return '';
    }
    // Computed item lists take no injection.
    $style = \Drupal::entityTypeManager()->getStorage('image_style')->load('avatar');
    // Relative, so a cached mark serves every host; no style, no picture, as
    // EntityImageTrait answers for workspace marks.
    return $style instanceof ImageStyleInterface
      ? \Drupal::service('file_url_generator')->transformRelative($style->buildUrl($file->getFileUri()))
      : '';
  }

}
