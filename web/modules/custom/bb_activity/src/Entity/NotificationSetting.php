<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\Field\FieldStorageDefinitionInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_activity\Access\NotificationSettingAccessControlHandler;
use Drupal\bb_activity\Form\NotificationSettingsForm;
use Drupal\bb_activity\Storage\NotificationSettingStorageSchema;
use Drupal\user\EntityOwnerTrait;

/**
 * One account's activity mail choices: the ticked message IDs, nothing else.
 *
 * The choices are plain strings; which offers exist is the activity mails'
 * business, read by the settings form, never by a field definition. Not a
 * BbContentEntityBase: the row has no workspace URL and no created date.
 * Internal, so JSON:API exposes no resource.
 */
#[ContentEntityType(
  id: 'bb_notification_setting',
  label: new TranslatableMarkup('Notification setting'),
  label_collection: new TranslatableMarkup('Notification settings'),
  label_singular: new TranslatableMarkup('notification setting'),
  label_plural: new TranslatableMarkup('notification settings'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'owner' => 'user_id'],
  handlers: [
    'access' => NotificationSettingAccessControlHandler::class,
    'storage_schema' => NotificationSettingStorageSchema::class,
    'form' => ['default' => NotificationSettingsForm::class],
  ],
  admin_permission: 'administer bakers',
  base_table: 'bb_notification_setting',
  internal: TRUE,
)]
final class NotificationSetting extends ContentEntityBase implements NotificationSettingInterface {

  use EntityOwnerTrait;

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['user_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Account'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'user');
    $fields['messages'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Messages'))
      ->setDescription(new TranslatableMarkup('The ticked activity messages, each as kind.key.'))
      ->setCardinality(FieldStorageDefinitionInterface::CARDINALITY_UNLIMITED)
      ->setSetting('max_length', 128);
    return $fields;
  }

  /**
   * {@inheritdoc}
   */
  public function ticked(): array {
    return array_values(array_map(
      static fn (array $item): string => (string) $item['value'],
      $this->get('messages')->getValue(),
    ));
  }

}
