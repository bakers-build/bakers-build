<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityChangedTrait;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityPermissionProvider;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_inbox\Access\BbInboxMessageAccessControlHandler;
use Drupal\bb_inbox\Access\BbInboxMessageQueryAccessHandler;
use Drupal\user\EntityOwnerTrait;

/**
 * A message from the server to one conductor.
 *
 * The inbox knows no handlers: whoever is responsible for the `message_id`
 * validates it through InboxMessageEvent (see the entity constraint).
 */
#[ContentEntityType(
  id: 'bb_inbox_message',
  label: new TranslatableMarkup('bakers.build inbox message'),
  label_collection: new TranslatableMarkup('bakers.build inbox messages'),
  label_singular: new TranslatableMarkup('bakers.build inbox message'),
  label_plural: new TranslatableMarkup('bakers.build inbox messages'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid', 'owner' => 'owner_user_id'],
  handlers: [
    'access' => BbInboxMessageAccessControlHandler::class,
    'query_access' => BbInboxMessageQueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
  ],
  admin_permission: 'administer bakers',
  constraints: ['BbInboxMessage' => []],
  base_table: 'bb_inbox_message',
)]
final class BbInboxMessage extends ContentEntityBase implements BbInboxMessageInterface {

  use EntityChangedTrait;
  use EntityOwnerTrait;

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['ticket_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Ticket'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'bb_ticket');
    $fields['conductor_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Conductor'))
      ->setSetting('target_type', 'bb_conductor');
    $fields['message_id'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Message id'))
      ->setRequired(TRUE)
      ->setSetting('max_length', 120);
    $fields['version'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Handler version'))
      ->setSetting('max_length', 64);
    // JSON in string_long, not `map`: a map serialises `{}` as `[]`.
    $fields['payload'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Payload'))
      ->setDefaultValue('{}');
    $fields['status'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('Status'))
      ->setRequired(TRUE)
      ->setSetting('allowed_values', [
        self::STATUS_PENDING => 'Pending',
        self::STATUS_RUNNING => 'Running',
        self::STATUS_DONE => 'Done',
        self::STATUS_FAILED => 'Failed',
      ])
      ->setDefaultValue(self::STATUS_PENDING);
    $fields['result'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Result'));
    $fields['requested_by'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Requested by'))
      ->setSetting('target_type', 'user');
    // The conductor's owner, copied at send time so query access is a column
    // comparison. Defaults to anonymous, never to the acting account.
    $fields['owner_user_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Conductor owner'))
      ->setSetting('target_type', 'user')
      ->setDefaultValue(0);
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
      $conductor = $this->ticket()?->getConductor();
      $this->set('conductor_id', $conductor?->id());
      $this->set('owner_user_id', $conductor?->get('owner_user_id')->target_id ?? 0);
      $this->set('status', self::STATUS_PENDING);
      $this->set('result', NULL);
    }
  }

  /**
   * {@inheritdoc}
   */
  public function messageId(): string {
    return (string) $this->get('message_id')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function ticket(): ?BbTicketInterface {
    $ticket = $this->get('ticket_id')->entity;
    return $ticket instanceof BbTicketInterface ? $ticket : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function conductor(): ?BbConductorInterface {
    if ($this->isNew()) {
      return $this->ticket()?->getConductor();
    }
    $conductor = $this->get('conductor_id')->entity;
    return $conductor instanceof BbConductorInterface ? $conductor : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function status(): string {
    return (string) $this->get('status')->value;
  }

  /**
   * {@inheritdoc}
   */
  public function payload(): array {
    $decoded = json_decode((string) $this->get('payload')->value, TRUE);
    return is_array($decoded) ? $decoded : [];
  }

  /**
   * {@inheritdoc}
   */
  public function result(): ?array {
    $raw = $this->get('result')->value;
    if ($raw === NULL || $raw === '') {
      return NULL;
    }
    $decoded = json_decode((string) $raw, TRUE);
    return is_array($decoded) ? $decoded : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function setResult(string $status, array|object|null $result): static {
    $this->set('status', $status);
    $this->set('result', $result === NULL ? NULL : json_encode(is_array($result) ? (object) $result : $result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    return $this;
  }

}
