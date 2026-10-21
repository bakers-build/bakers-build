<?php

declare(strict_types=1);

namespace Drupal\bb_track\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityChangedTrait;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityViewBuilder;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\datetime\Plugin\Field\FieldType\DateTimeItem;
use Drupal\bb_track\Access\WorklogAccessControlHandler;
use Drupal\bb_track\Access\WorklogQueryAccessHandler;
use Drupal\bb_track\ViewsData\WorklogViewsData;
use Drupal\bb_track\WorkTimeRules;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\EntityOwnerTrait;

/**
 * Manual Worklog for one owner's recorded time.
 */
#[ContentEntityType(
  id: 'bb_track_worklog',
  label: new TranslatableMarkup('Worklog'),
  label_collection: new TranslatableMarkup('Worklogs'),
  label_singular: new TranslatableMarkup('worklog'),
  label_plural: new TranslatableMarkup('worklogs'),
  entity_keys: [
    'id' => 'id',
    'uuid' => 'uuid',
    'owner' => 'owner_user_id',
  ],
  handlers: [
    'storage' => \Drupal\bb_track\Storage\WorklogStorage::class,
    'access' => WorklogAccessControlHandler::class,
    'query_access' => WorklogQueryAccessHandler::class,
    'view_builder' => EntityViewBuilder::class,
    'views_data' => WorklogViewsData::class,
  ],
  base_table: 'bb_track_worklog',
  constraints: [
    'Worklog' => [],
  ],
)]
final class Worklog extends ContentEntityBase implements EntityOwnerInterface {

  /**
   * Expected browser revision, checked again inside the employee lock.
   */
  public ?string $expectedVersion = NULL;

  use EntityChangedTrait;
  use EntityOwnerTrait;

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);

    $fields['created'] = BaseFieldDefinition::create('created')
      ->setLabel(new TranslatableMarkup('Created'));
    $fields['changed'] = BaseFieldDefinition::create('changed')
      ->setLabel(new TranslatableMarkup('Changed'));

    $fields['owner_user_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Owner'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'user');

    $fields['work_date'] = BaseFieldDefinition::create('datetime')
      ->setLabel(new TranslatableMarkup('Date'))
      ->setRequired(TRUE)
      ->setSettings([
        'datetime_type' => DateTimeItem::DATETIME_TYPE_DATE,
      ]);

    $fields['timezone'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Timezone'))
      ->setRequired(TRUE)
      ->setSetting('max_length', 64);

    $fields['duration_seconds'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Duration (seconds)'))
      ->addPropertyConstraints('value', [
        'Range' => [
          'min' => 60,
          'max' => WorkTimeRules::MAX_ENTRY_SECONDS,
        ],
      ]);

    $fields['description'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Description'))
      ->setRequired(TRUE)
      ->addPropertyConstraints('value', [
        'Length' => [
          'max' => 2000,
        ],
      ]);

    $fields['derivation'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('Derivation'))
      ->setRequired(TRUE)
      ->setSetting('allowed_values', [
        'manual' => 'Manual',
      ])
      ->setDefaultValue('manual');

    $fields['state'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('State'))->setRequired(TRUE)
      ->setSetting('allowed_values', [
        'recorded' => 'Recorded',
        'approved' => 'Approved',
        'proposed' => 'Proposed',
      ])->setDefaultValue('recorded');

    $fields['project_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Project'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'bb_project');

    $fields['ticket_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Ticket'))
      ->setSetting('target_type', 'bb_ticket');

    $fields['account_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Billing account'))->setRequired(TRUE)->setSetting('target_type', 'bb_track_account');
    $fields['submission_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Submission'))->setSetting('target_type', 'bb_track_submission');
    $fields['source_keys'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Source identities'))->setCardinality(-1)->setSetting('max_length', 64);
    $fields['source_data'] = BaseFieldDefinition::create('string_long')
      ->setLabel(new TranslatableMarkup('Original source measurements'));
    $fields['source_revision'] = BaseFieldDefinition::create('integer')
      ->setLabel(new TranslatableMarkup('Source revision'))->setDefaultValue(0);
    $fields['voided'] = BaseFieldDefinition::create('boolean')
      ->setLabel(new TranslatableMarkup('Voided'))->setDefaultValue(FALSE);
    return $fields;
  }

  /**
   * Original inputs stay attached when a suggestion becomes recorded work.
   */
  public function sources(): array {
    return json_decode($this->get('source_data')->value ?: '{}', TRUE, 32, JSON_THROW_ON_ERROR);
  }

  /**
   * Digest of persisted identity and editable fields for concurrent-tab locks.
   */
  public function version(): string {
    $payload = [
      'account_id' => (string) ($this->get('account_id')->target_id ?? ''),
      'sources' => $this->get('source_data')->value,
      'voided' => (bool) $this->get('voided')->value,
      'source_revision' => (int) $this->get('source_revision')->value,
      'id' => (string) $this->id(),
      'owner_user_id' => (string) $this->get('owner_user_id')->target_id,
      'work_date' => (string) $this->get('work_date')->value,
      'timezone' => (string) $this->get('timezone')->value,
      'duration_seconds' => (string) (int) $this->get('duration_seconds')->value,
      'description' => (string) $this->get('description')->value,
      'derivation' => (string) $this->get('derivation')->value,
      'state' => (string) $this->get('state')->value,
      'project_id' => (string) ($this->get('project_id')->target_id ?? ''),
      'ticket_id' => (string) ($this->get('ticket_id')->target_id ?? ''),
    ];
    return hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));
  }

}
