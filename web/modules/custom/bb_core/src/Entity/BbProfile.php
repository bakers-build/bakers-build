<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityChangedTrait;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Access\BbProfileAccessControlHandler;
use Drupal\bb_core\Form\UserProfileForm;
use Drupal\bb_core\Storage\BbProfileStorageSchema;
use Drupal\user\EntityOwnerTrait;

/**
 * An account's position, background and favorite projects in one workspace.
 *
 * At most one per account and workspace (BbProfileStorageSchema). Grants no
 * access: it is descriptive data, read by the run context and the rail.
 */
#[ContentEntityType(
  id: 'bb_profile',
  label: new TranslatableMarkup('bakers.build profile'),
  label_collection: new TranslatableMarkup('bakers.build profiles'),
  label_singular: new TranslatableMarkup('bakers.build profile'),
  label_plural: new TranslatableMarkup('bakers.build profiles'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'owner' => 'uid'],
  handlers: [
    'access' => BbProfileAccessControlHandler::class,
    'storage_schema' => BbProfileStorageSchema::class,
    'form' => ['default' => UserProfileForm::class],
  ],
  base_table: 'bb_profile',
  admin_permission: 'administer bakers',
)]
final class BbProfile extends ContentEntityBase implements BbProfileInterface {

  use EntityChangedTrait;
  use EntityOwnerTrait;
  use BbBaseFieldsTrait;

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['uid'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Owner'))
      ->setSetting('target_type', 'user')
      ->setRequired(TRUE);
    $fields['workspace_id'] = static::workspaceBaseFieldDefinition(NULL);
    $fields['position'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Position'))
      ->setSetting('max_length', 255)
      ->setDisplayOptions('form', [
        'type' => 'string_textfield',
        'weight' => 4,
        'settings' => ['size' => 60, 'placeholder' => 'e.g. Product Lead'],
      ]);
    $fields['background'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('What should bakers.build know about your background?'))
      ->setDescription(new TranslatableMarkup('Optional, e.g. "Drupal developer, confident with PHP; little DevOps experience."'))
      ->setDisplayOptions('form', ['type' => 'string_textarea', 'weight' => 5, 'settings' => ['rows' => 3]]);
    $fields['favorite_projects'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Favorite projects'))
      ->setSetting('target_type', 'bb_project')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED);
    $fields['changed'] = BaseFieldDefinition::create('changed')
      ->setLabel(new TranslatableMarkup('Changed'));
    return $fields;
  }

  /**
   * {@inheritdoc}
   */
  public function workspaceId(): int {
    return (int) $this->get('workspace_id')->target_id;
  }

  /**
   * {@inheritdoc}
   */
  public function position(): string {
    return (string) $this->get('position')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setPosition(string $position): static {
    return $this->set('position', $position);
  }

  /**
   * {@inheritdoc}
   */
  public function background(): string {
    return (string) $this->get('background')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function setBackground(string $background): static {
    return $this->set('background', $background);
  }

  /**
   * {@inheritdoc}
   */
  public function favoriteProjectIds(): array {
    return array_map('intval', array_column($this->get('favorite_projects')->getValue(), 'target_id'));
  }

  /**
   * {@inheritdoc}
   */
  public function toggleFavorite(int $project_id): static {
    $ids = $this->favoriteProjectIds();
    $ids = in_array($project_id, $ids, TRUE) ? array_diff($ids, [$project_id]) : [...$ids, $project_id];
    return $this->set('favorite_projects', array_values($ids));
  }

}
