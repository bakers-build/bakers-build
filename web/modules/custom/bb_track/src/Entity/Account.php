<?php

declare(strict_types=1);

namespace Drupal\bb_track\Entity;

use Drupal\Core\Entity\Attribute\ContentEntityType;
use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_track\Access\AccountAccess;
use Drupal\bb_track\Access\AccountQueryAccessHandler;
use Drupal\bb_track\Storage\AccountStorage;

/**
 * A project's billing account: the project default, or linked by tickets.
 *
 * A project has several accounts and exactly one active default. A ticket is
 * linked by at most one active account; an account that links tickets is
 * never the default. Both rules are enforced by AccountGuard.
 */
#[ContentEntityType(
  id: 'bb_track_account',
  label: new TranslatableMarkup('Billing account'),
  entity_keys: [
    'id' => 'id',
    'uuid' => 'uuid',
    'label' => 'name',
  ],
  handlers: [
    'storage' => AccountStorage::class,
    'access' => AccountAccess::class,
    'query_access' => AccountQueryAccessHandler::class,
  ],
  base_table: 'bb_track_account',
  constraints: ['BillingAccount' => []],
  // Few rows, read under the account lock: a cached copy a racing render
  // wrote back could be stale and get saved over a newer link.
  persistent_cache: FALSE,
)]
final class Account extends ContentEntityBase {

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {
    $fields = parent::baseFieldDefinitions($entity_type);
    $fields['name'] = BaseFieldDefinition::create('string')->setLabel(new TranslatableMarkup('Name'))->setRequired(TRUE);
    $fields['project_id'] = BaseFieldDefinition::create('entity_reference')->setLabel(new TranslatableMarkup('Project'))
      ->setSetting('target_type', 'bb_project')->setRequired(TRUE);
    $fields['tickets'] = BaseFieldDefinition::create('entity_reference')->setLabel(new TranslatableMarkup('Tickets'))
      ->setSetting('target_type', 'bb_ticket')->setCardinality(BaseFieldDefinition::CARDINALITY_UNLIMITED);
    $fields['is_default'] = BaseFieldDefinition::create('boolean')->setLabel(new TranslatableMarkup('Project default'))->setDefaultValue(FALSE);
    $fields['external_id'] = BaseFieldDefinition::create('string')->setLabel(new TranslatableMarkup('External ID'))
      ->setDescription(new TranslatableMarkup('ID in the external billing system, e.g. a Harvest project ID.'))
      ->setSetting('max_length', 255);
    $fields['active'] = BaseFieldDefinition::create('boolean')->setLabel(new TranslatableMarkup('Active'))->setDefaultValue(TRUE);
    // Billing terms; AccountValidation::terms() says which belong to a type.
    $fields['billing_type'] = BaseFieldDefinition::create('list_string')->setLabel(new TranslatableMarkup('Type'))->setRequired(TRUE)
      ->setSetting('allowed_values', [
        'time_material' => 'Time & Materials',
        'fixed_fee' => 'Fixed Fee',
        'non_billable' => 'Non-Billable',
      ])
      ->setDefaultValue('time_material')->setInitialValue('time_material');
    $fields['budget_kind'] = BaseFieldDefinition::create('list_string')->setLabel(new TranslatableMarkup('Budget'))->setRequired(TRUE)
      ->setSetting('allowed_values', ['none' => 'No budget', 'hours' => 'Hours', 'amount' => 'Amount'])
      ->setDefaultValue('none')->setInitialValue('none');
    $fields['budget_value'] = self::amount(new TranslatableMarkup('Budget value'));
    $fields['budget_resets_monthly'] = BaseFieldDefinition::create('boolean')->setLabel(new TranslatableMarkup('Budget resets every month'))
      ->setDefaultValue(FALSE)->setInitialValue(FALSE);
    $fields['fixed_fee'] = self::amount(new TranslatableMarkup('Fixed fee'));
    $fields['hourly_rate'] = self::amount(new TranslatableMarkup('Hourly rate'));
    return $fields;
  }

  /**
   * An optional two-decimal number: hours or money, without currency.
   */
  private static function amount(TranslatableMarkup $label): BaseFieldDefinition {
    return BaseFieldDefinition::create('decimal')->setLabel($label)->setSetting('precision', 12)->setSetting('scale', 2);
  }

  /**
   * Whether the stored copy of this account is archived.
   */
  public function isArchivedInStorage(): bool {
    $stored = $this->isNew() ? NULL : $this->entityTypeManager()->getStorage('bb_track_account')->loadUnchanged($this->id());
    return $stored instanceof self && !$stored->get('active')->value;
  }

}
