<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Provides the required `name` string field and its accessor.
 */
trait BbNameTrait {

  /**
   * Builds the required `name` field.
   *
   * @param int|null $weight
   *   The form widget weight, or NULL for no default form widget.
   */
  protected static function nameBaseFieldDefinition(?int $weight): BaseFieldDefinition {
    $field = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Name'))
      ->setRequired(TRUE)
      ->setSetting('max_length', 255)
      ->setDisplayConfigurable('form', TRUE);
    if ($weight !== NULL) {
      $field->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => $weight]);
    }
    return $field;
  }

  /**
   * {@inheritdoc}
   */
  public function getName(): string {
    return (string) $this->get('name')->value;
  }

}
