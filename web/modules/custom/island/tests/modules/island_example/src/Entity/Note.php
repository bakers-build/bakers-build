<?php

declare(strict_types=1);

namespace Drupal\island_example\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island_example\Form\NoteForm;

/**
 * Demo content entity edited through an entity-form island.
 */
#[ContentEntityType(
  id: 'island_example_note',
  label: new TranslatableMarkup('Island example note'),
  entity_keys: [
    'id' => 'id',
    'label' => 'title',
  ],
  handlers: [
    'form' => [
      'default' => NoteForm::class,
      'edit' => NoteForm::class,
    ],
  ],
  base_table: 'island_example_note',
)]
final class Note extends ContentEntityBase {

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    // Declared rather than implied. This fixture deliberately does NOT call
    // parent::baseFieldDefinitions() — it defines the only field it keys on
    // itself — and starting from an undefined variable made that look like an
    // oversight instead of a decision.
    $fields = [];

    $fields['id'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('ID'))
      ->setReadOnly(TRUE)
      ->setSetting('unsigned', TRUE);

    $fields['title'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Title'))
      ->setRequired(TRUE)
      ->setDisplayOptions('form', ['type' => 'string_textfield', 'weight' => 0])
      ->setDisplayConfigurable('form', TRUE);

    $fields['body'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Body'))
      ->setDisplayOptions('form', ['type' => 'string_textarea', 'weight' => 1])
      ->setDisplayConfigurable('form', TRUE);

    return $fields;
  }

}
