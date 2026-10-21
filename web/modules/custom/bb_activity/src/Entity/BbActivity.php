<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityViewBuilder;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityPermissionProvider;
use Drupal\bb_activity\Activity\ActivityKindManager;
use Drupal\bb_activity\Access\BbActivityAccessControlHandler;
use Drupal\bb_activity\Access\BbActivityQueryAccessHandler;
use Drupal\bb_activity\Storage\BbActivityStorageSchema;
use Drupal\bb_core\Entity\BbContentEntityBase;
use Drupal\views\EntityViewsData;

/**
 * A persisted ticket event; its kind is an activity kind plugin.
 *
 * Writes originate only from activity kinds, called by their causers. There
 * is no client create/update/delete and no owner-based read grant; visibility
 * follows the parent ticket.
 */
#[ContentEntityType(
  id: 'bb_activity',
  label: new TranslatableMarkup('bakers.build activity'),
  label_collection: new TranslatableMarkup('bakers.build activities'),
  label_singular: new TranslatableMarkup('bakers.build activity'),
  label_plural: new TranslatableMarkup('bakers.build activities'),
  entity_keys: ['id' => 'id', 'uuid' => 'uuid'],
  handlers: [
    'access' => BbActivityAccessControlHandler::class,
    'query_access' => BbActivityQueryAccessHandler::class,
    'permission_provider' => EntityPermissionProvider::class,
    'view_builder' => EntityViewBuilder::class,
    'views_data' => EntityViewsData::class,
    'storage_schema' => BbActivityStorageSchema::class,
  ],
  admin_permission: 'administer bakers',
  base_table: 'bb_activity',
  additional: [
    // Read by bb_core's workspace resolver and rank fence: an activity
    // belongs to its ticket's workspace.
    'bb_workspace_path' => ['ticket_id', 'project_id', 'group_id', 'workspace_id'],
    // Its query handler materializes readable ticket ids, so bb_core's
    // JSON:API filter-access hook must cover it explicitly.
    'bb_jsonapi_filter_scope' => TRUE,
  ],
)]
final class BbActivity extends BbContentEntityBase {

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);

    $fields['ticket_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Ticket'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'bb_ticket');

    $fields['kind'] = BaseFieldDefinition::create('list_string')
      ->setLabel(new TranslatableMarkup('Kind'))
      ->setRequired(TRUE)
      ->setSetting('allowed_values_function', ActivityKindManager::class . '::allowedValues');

    $fields['actor'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Actor'))
      ->setSetting('target_type', 'user')
      ->setDescription(new TranslatableMarkup('The initiating authenticated account. Zero only for an actual system context.'));

    $fields['workflow'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Workflow'))
      ->setDescription(new TranslatableMarkup('Snapshot of the ticket workflow machine name at capture. Empty is valid for an unclassified ticket.'));

    $fields['previous_state'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Previous state'))
      ->setDescription(new TranslatableMarkup('Machine name of the stored state before a status change. Empty is valid. Unused for claims.'));

    $fields['new_state'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('New state'))
      ->setDescription(new TranslatableMarkup('Machine name of the stored state after a status change, or the first state of a created ticket. Empty is valid. Unused for claims.'));

    $fields['step'] = BaseFieldDefinition::create('string')
      ->setLabel(new TranslatableMarkup('Step'))
      ->setDescription(new TranslatableMarkup('The claimed or ended run’s state_at_start, not the ticket state at read time.'));

    $fields['run_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Run'))
      ->setDescription(new TranslatableMarkup('The claimed or ended run, or the run a status change closed. Empty for a change without an active run.'))
      ->setSetting('target_type', 'bb_run');

    $fields['conductor_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Conductor'))
      ->setSetting('target_type', 'bb_conductor');

    $fields['comment_id'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Summary comment'))
      ->setDescription(new TranslatableMarkup('The comment the activity points to: the summary published in the previous state of a status change, or the submitted review.'))
      ->setSetting('target_type', 'bb_comment');

    $fields['accounts'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(new TranslatableMarkup('Accounts'))
      ->setDescription(new TranslatableMarkup('The accounts the activity is addressed to, such as the reviewers a review was requested from.'))
      ->setSetting('target_type', 'user')
      ->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED);

    $created = $fields['created'];
    assert($created instanceof BaseFieldDefinition);
    $created->setDisplayConfigurable('view', TRUE);

    return $fields;
  }

}
