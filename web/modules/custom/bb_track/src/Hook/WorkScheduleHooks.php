<?php

declare(strict_types=1);

namespace Drupal\bb_track\Hook;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_track\WorkTimeSettings;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\user\UserInterface;

/**
 * Private schedule storage on its owning user, written by checked operations.
 */
final class WorkScheduleHooks {

  /**
   * Constructs the private user-field hooks.
   */
  public function __construct(private WorkTimeSettings $settings, private EntityTypeManagerInterface $entities) {}

  /**
   * Declares the personal weekday field.
   */
  #[Hook('entity_base_field_info')]
  public function fields(EntityTypeInterface $entity_type): array {
    if ($entity_type->id() !== 'user') {
      return [];
    }
    return [
      'work_schedule' => BaseFieldDefinition::create('bb_work_schedule')
        ->setLabel(new TranslatableMarkup('Work schedule'))->setCardinality(1),
    ];
  }

  /**
   * Prevents user forms and generic API writes from bypassing owner operations.
   */
  #[Hook('entity_field_access')]
  public function access(string $operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResult {
    if ($field_definition->getTargetEntityTypeId() !== 'user' || $field_definition->getName() !== 'work_schedule') {
      return AccessResult::neutral();
    }
    return ($operation === 'view' && $account->isAuthenticated()
      && $items && (int) $items->getEntity()->id() === (int) $account->id() ? AccessResult::allowed() : AccessResult::forbidden())->cachePerUser();
  }

  /**
   * Direct saves also honor the checked schedule operation.
   */
  #[Hook('user_presave')]
  public function protect(UserInterface $user): void {
    if ($this->settings->mayPersist($user)) {
      return;
    }
    $original = $user->isNew() ? NULL : $this->entities->getStorage('user')->loadUnchanged($user->id());
    $current = $user->get('work_schedule');
    $originalField = $original?->get('work_schedule');
    $unchanged = $current->isEmpty()
      ? ($originalField === NULL || $originalField->isEmpty())
      : $current->getValue() === ($originalField?->getValue() ?? []);
    if (!$unchanged) {
      throw new \DomainException('Use the personal schedule operation.');
    }
  }

}
