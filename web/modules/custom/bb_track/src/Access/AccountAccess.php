<?php

declare(strict_types=1);

namespace Drupal\bb_track\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityAccessControlHandler;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_track\AccountValidation;
use Drupal\bb_track\Entity\Account;

/**
 * Billing account access follows the project's update access, both ways.
 *
 * View follows project visibility; the external ID and billing terms are
 * read only by those who may update the project. Create, update and
 * deactivate (PATCH active=false) of an active account follow project update
 * access, the same right the UI forms already require, so JSON:API and dropsh
 * writes are authorized identically to the form. An archived account is
 * read-only, as in the UI. Physical deletion stays prohibited for every actor:
 * it is never the retention contract's way to archive an account.
 */
final class AccountAccess extends EntityAccessControlHandler {

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account) {
    assert($entity instanceof Account);
    if ($operation === 'delete') {
      return AccessResult::forbidden('Billing accounts are archived, never deleted.');
    }
    $project = $entity->get('project_id')->entity;
    if (!$project) {
      return AccessResult::forbidden()->addCacheableDependency($entity);
    }
    if ($operation === 'view') {
      return AccessResult::allowedIf($project->access('view', $account))
        ->addCacheableDependency($project->access('view', $account, TRUE))
        ->addCacheableDependency($project)->addCacheableDependency($entity)->cachePerUser();
    }
    if ($operation === 'update') {
      return $this->projectUpdateAccess($entity, $account);
    }
    return AccessResult::forbidden();
  }

  /**
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL) {
    // Context carries no target project here: the deserialized entity's
    // project_id field access (below) is where the real gate runs.
    return AccessResult::allowedIf(!$account->isAnonymous())->addCacheContexts(['user.roles:anonymous']);
  }

  /**
   * Restricts writable fields to those the UI exposes.
   *
   * No relocation, default or ticket-link writes through the API.
   *
   * {@inheritdoc}
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL) {
    $name = $field_definition->getName();
    $entity = $items?->getEntity();
    if ($operation !== 'edit') {
      return $this->fieldViewAccess($operation, $field_definition, $account, $items);
    }
    if (in_array($name, ['tickets', 'is_default'], TRUE)) {
      return AccessResult::forbidden('Tickets and the project default are managed by WorkAssignments, not the API.');
    }
    if ($name === 'project_id') {
      if (!$entity instanceof Account || !$entity->isNew()) {
        return AccessResult::forbidden('The project of an existing billing account cannot change.');
      }
      return $this->projectUpdateAccess($entity, $account);
    }
    if (in_array($name, ['name', 'external_id', 'active', ...AccountValidation::TERMS], TRUE) && $entity instanceof Account) {
      return $this->projectUpdateAccess($entity, $account);
    }
    return parent::checkFieldAccess($operation, $field_definition, $account, $items);
  }

  /**
   * The entity's project's update access, cacheable on both.
   */
  private function projectUpdateAccess(Account $entity, AccountInterface $account): AccessResultInterface {
    // The UI answers 404 for an archived account; the API matches it.
    if ($entity->isArchivedInStorage()) {
      return AccessResult::forbidden('Archived billing accounts cannot be edited.')->addCacheableDependency($entity);
    }
    return $this->projectEditorAccess($entity, $account);
  }

  /**
   * Field view: prices are for those who may edit the project, archived too.
   */
  private function fieldViewAccess(string $operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items): AccessResultInterface {
    $entity = $items?->getEntity();
    $priced = ['external_id', ...AccountValidation::TERMS];
    if ($operation === 'view' && $entity instanceof Account && in_array($field_definition->getName(), $priced, TRUE)) {
      return $this->projectEditorAccess($entity, $account);
    }
    return parent::checkFieldAccess($operation, $field_definition, $account, $items);
  }

  /**
   * Whether the account may update the entity's project, cacheable on both.
   */
  private function projectEditorAccess(Account $entity, AccountInterface $account): AccessResultInterface {
    $project = $entity->get('project_id')->entity;
    if (!$project) {
      return AccessResult::forbidden('Billing account needs an existing project.');
    }
    return AccessResult::allowedIf($project->access('update', $account))
      ->addCacheableDependency($project->access('update', $account, TRUE))
      ->addCacheableDependency($project)->addCacheableDependency($entity)->cachePerUser();
  }

}
