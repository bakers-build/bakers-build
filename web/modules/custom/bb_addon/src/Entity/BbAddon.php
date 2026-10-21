<?php

declare(strict_types=1);

namespace Drupal\bb_addon\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityChangedTrait;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_addon\Access\BbAddonAccessControlHandler;
use Drupal\bb_addon\Storage\BbAddonStorageSchema;
use Drupal\bb_addon\ViewsData\BbAddonViewsData;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * An addon definition at one version, created by the conductors running it.
 *
 * One row per distinct definition of (name, version), so no conductor can
 * lock another out of a version; the definition is immutable once stored.
 *
 * @SuppressWarnings("PHPMD.TooManyPublicMethods")
 *   The accessors are the definition's read API for both UIs.
 */
#[ContentEntityType(
  id: 'bb_addon',
  label: new TranslatableMarkup('bakers.build addon'),
  label_collection: new TranslatableMarkup('bakers.build addons'),
  label_singular: new TranslatableMarkup('bakers.build addon'),
  label_plural: new TranslatableMarkup('bakers.build addons'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'label' => 'name'],
  handlers: [
    'access' => BbAddonAccessControlHandler::class,
    'views_data' => BbAddonViewsData::class,
    'storage_schema' => BbAddonStorageSchema::class,
  ],
  admin_permission: 'administer bakers',
  base_table: 'bb_addon',
)]
final class BbAddon extends ContentEntityBase implements BbAddonInterface {

  use EntityChangedTrait;

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['workspace_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Workspace'))
      ->setSetting('target_type', 'bb_workspace')
      ->setRequired(TRUE);
    $fields['name'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Name'))
      ->setRequired(TRUE)
      ->setSetting('max_length', 41);
    $fields['version'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Version'))
      ->setRequired(TRUE)
      ->setSetting('max_length', 64);
    $fields['contract'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Contract'))
      ->setRequired(TRUE);
    $fields['definition'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Definition'))
      ->setRequired(TRUE);
    $fields['conductors'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Conductors'))
      ->setSetting('target_type', 'bb_conductor')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED);
    $fields['created'] = BaseFieldDefinition::create('created')
      ->setLabel(new TranslatableMarkup('Created'));
    $fields['changed'] = BaseFieldDefinition::create('changed')
      ->setLabel(new TranslatableMarkup('Changed'));
    return $fields;
  }

  /**
   * {@inheritdoc}
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    if ($this->isNew()) {
      return;
    }
    $original = $storage->loadUnchanged($this->id());
    if ($original instanceof BbAddonInterface && $original->definition() !== $this->definition()) {
      throw new EntityStorageException(sprintf('The definition of %s@%s is immutable.', $this->name(), $this->version()));
    }
    // Zero means "never set" (the BB-661 migration backfill, or any site
    // still mid-upgrade); only a CHANGE away from an already-set workspace is
    // the immutability violation.
    if ($original instanceof BbAddonInterface && $original->workspaceId() !== 0 && $original->workspaceId() !== $this->workspaceId()) {
      throw new EntityStorageException(sprintf('The workspace of %s@%s is immutable.', $this->name(), $this->version()));
    }
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
  public function getWorkspace(): ?BbWorkspaceInterface {
    $entity = $this->get('workspace_id')->entity;
    return $entity instanceof BbWorkspaceInterface ? $entity : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function name(): string {
    return (string) $this->get('name')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function version(): string {
    return (string) $this->get('version')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function contract(): int {
    return (int) $this->get('contract')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function definition(): array {
    $decoded = json_decode((string) $this->get('definition')->value, TRUE);
    return is_array($decoded) ? $decoded : [];
  }

  /**
   * {@inheritdoc}
   */
  public function label(): string {
    $label = $this->definition()['label'] ?? NULL;
    return is_string($label) && $label !== '' ? $label : ucfirst($this->name());
  }

  /**
   * {@inheritdoc}
   */
  public function message(string $key): ?array {
    $message = $this->definition()['messages'][$key] ?? NULL;
    return is_array($message) ? $message : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function capability(string $key): ?array {
    return $this->message($key);
  }

  /**
   * {@inheritdoc}
   */
  public function runsOn(BbConductorInterface $conductor): bool {
    $ids = array_map('intval', array_column($this->get('conductors')->getValue(), 'target_id'));
    return in_array((int) $conductor->id(), $ids, TRUE);
  }

  /**
   * {@inheritdoc}
   */
  public function addConductor(BbConductorInterface $conductor): static {
    if (!$this->runsOn($conductor)) {
      $this->get('conductors')->appendItem($conductor->id());
    }
    return $this;
  }

  /**
   * {@inheritdoc}
   */
  public function removeConductor(BbConductorInterface $conductor): static {
    $this->get('conductors')->filter(
      static fn ($item) => (int) ($item->getValue()['target_id'] ?? 0) !== (int) $conductor->id(),
    );
    return $this;
  }

}
