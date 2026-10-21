<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Config\Entity\ConfigEntityBundleBase;
use Drupal\Core\Entity\Attribute\ConfigEntityType;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Defines the bakers.build vocabulary config entity — a bundle of bb_term.
 *
 * `ConfigEntityBundleBase` rather than `ConfigEntityBase`: its postSave() and
 * postDelete() clear the cached bundle info, without which a recipe that
 * creates the vocabulary and a display in one request aborts with
 * "Missing entity bundle".
 *.
 */
#[ConfigEntityType(
  id: 'bb_vocabulary',
  label: new TranslatableMarkup('bakers.build vocabulary'),
  label_collection: new TranslatableMarkup('bakers.build vocabularies'),
  label_singular: new TranslatableMarkup('bakers.build vocabulary'),
  label_plural: new TranslatableMarkup('bakers.build vocabularies'),
  config_prefix: 'bb_vocabulary',
  entity_keys: ['id' => 'id', 'label' => 'label'],
  admin_permission: 'administer bakers',
  bundle_of: 'bb_term',
  config_export: ['id', 'label', 'description'],
)]
final class BbVocabulary extends ConfigEntityBundleBase implements BbVocabularyInterface {

  /**
   * The vocabulary machine name (vid).
   */
  protected string $id = '';

  /**
   * The human-readable label.
   */
  protected string $label = '';

  /**
   * The vocabulary description.
   */
  protected string $description = '';

  /**
   * {@inheritdoc}
   */
  public function getDescription(): string {
    return $this->description;
  }

}
