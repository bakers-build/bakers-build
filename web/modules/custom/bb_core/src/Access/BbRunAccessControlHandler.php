<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;

/**
 * Allows conductor accounts to update their own run lease/observability data.
 */
final class BbRunAccessControlHandler extends EntityAccessControlHandler {

  private const CONDUCTOR_WRITABLE_FIELDS = [
    'state',
    'claim_expires_at',
    'started_at',
    'heartbeat',
    'worktree_path',
    // Chosen agent id, persisted by the conductor at dispatch.
    'agent',
    // `log` and `error_log` are the raw payload fields the conductor PATCHes;
    // preSave() writes each one through to a private file and clears it, so
    // the row never carries the payload. The six file/checksum/byte-count
    // fields that write-through produces (log_file, log_sha256, log_bytes and
    // the error_log equivalents) are deliberately NOT listed here — they are
    // derived server-side, so a conductor must not be able to PATCH a file
    // reference or a checksum directly.
    'log',
    // Failure detail written by the conductor when it terminalises the run to
    // `failed` on a dispatch/setup error.
    'error_log',
    // Omission-close flag: a recognized oversize upload falls back to a small
    // PATCH that sets this; BbRun::preSave() consumes it and clears it.
    'log_upload_omitted',
    'closed',
    'closed_date',
    // Footprint metrics — written by the run owner at close.
    'tokens',
    'duration_s',
    'active_s',
    'agent_turns',
    'tool_calls',
    'user_prompts',
    'user_prompt_words',
    // Runtime provenance — written by the run owner in the same close write as
    // the footprint metrics above.
    'harness',
    'model',
    'model_version',
  ];

  /**
   * Grants view and update access to the conductor that owns the run entity.
   *
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    $result = parent::checkAccess($entity, $operation, $account);
    if ($result->isAllowed()) {
      return $result;
    }
    return $this->ownerAccess($entity, $operation, $account)
      ?? $this->ticketEditorAccess($entity, $operation, $account)
      ?? $result;
  }

  /**
   * Checks whether the conductor owner may access the run.
   */
  private function ownerAccess(EntityInterface $entity, string $operation, AccountInterface $account): ?AccessResultInterface {
    if (!in_array($operation, ['view', 'update'], TRUE)
      || !$account->hasPermission('register bakers conductor')
      || !$entity instanceof BbRunInterface
      || !$this->ownsRun($entity, $account)) {
      return NULL;
    }
    return AccessResult::allowed()->cachePerUser()->addCacheableDependency($entity);
  }

  /**
   * The right to manage a run follows the right to edit its ticket.
   */
  private function ticketEditorAccess(EntityInterface $entity, string $operation, AccountInterface $account): ?AccessResultInterface {
    if ($operation !== 'update' || !$entity instanceof BbRunInterface) {
      return NULL;
    }
    $ticket = $entity->get('ticket_id')->entity;
    if ($ticket === NULL) {
      return NULL;
    }
    $ticket_access = $ticket->access('update', $account, TRUE);
    return $ticket_access->isAllowed()
      ? AccessResult::allowed()->addCacheableDependency($ticket_access)->addCacheableDependency($entity)
      : NULL;
  }

  /**
   * Restricts conductors to the allowed lease and observability fields only.
   *
   * {@inheritdoc}
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResultInterface {
    if ($operation !== 'edit' || $account->hasPermission('administer bakers')) {
      return parent::checkFieldAccess($operation, $field_definition, $account, $items);
    }
    $run = $items?->getEntity();
    // A ticket editor cancels a run they do not own. Only the state field,
    // and only on the strength of ticket update access, is delegated. This
    // check runs regardless of `register bakers conductor`: that permission is
    // the cockpit's own shape, not a precondition for the ticket-delegated
    // grant below.
    $ticket_access = $this->ticketStateAccess(
      $run,
      $field_definition->getName(),
      $account,
    );
    if ($ticket_access?->isAllowed()) {
      return AccessResult::allowed()
        ->cachePerUser()
        ->addCacheableDependency($ticket_access)
        ->addCacheableDependency($run);
    }
    $is_ticket_editor = $run instanceof BbRunInterface
      && $this->ticketEditorAccess($run, 'update', $account)?->isAllowed();
    if ($is_ticket_editor && !$account->hasPermission('register bakers conductor')) {
      // Delegated access grants only the state write above; every other
      // field of a run this account does not own is conductor telemetry and
      // stays closed — a hand-corrected telemetry value is worse
      // than a wrong one.
      return AccessResult::forbidden('Ticket editors may only change a run\'s state.')
        ->cachePerUser()
        ->addCacheableDependency($run);
    }
    return $this->conductorFieldAccess($run, $field_definition, $account)
      ?? parent::checkFieldAccess($operation, $field_definition, $account, $items);
  }

  /**
   * Restricts a conductor account to its own run's lease/observability fields.
   */
  private function conductorFieldAccess(?EntityInterface $run, FieldDefinitionInterface $field_definition, AccountInterface $account): ?AccessResultInterface {
    if (!$account->hasPermission('register bakers conductor')) {
      return NULL;
    }
    if ($run instanceof BbRunInterface && !$this->ownsRun($run, $account)) {
      return AccessResult::forbidden('Conductor accounts may only write their own runs.')
        ->cachePerUser()
        ->addCacheableDependency($run);
    }
    if (!in_array($field_definition->getName(), self::CONDUCTOR_WRITABLE_FIELDS, TRUE)) {
      return AccessResult::forbidden('Conductor accounts may only write lease and observability fields.')
        ->cachePerPermissions();
    }
    return NULL;
  }

  /**
   * Gets the ticket access result that delegates the run's state field.
   */
  private function ticketStateAccess(
    ?EntityInterface $entity,
    string $field_name,
    AccountInterface $account,
  ): ?AccessResultInterface {
    if (!$entity instanceof BbRunInterface || $field_name !== 'state') {
      return NULL;
    }
    return $this->ticketEditorAccess($entity, 'update', $account);
  }

  /**
   * Checks whether the given account owns the conductor linked to this run.
   *
   * @param \Drupal\bb_core\Entity\BbRunInterface $run
   *   The run entity to inspect.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to compare against.
   *
   * @return bool
   *   TRUE if the account's user ID matches the conductor's owner_user_id.
   */
  private function ownsRun(BbRunInterface $run, AccountInterface $account): bool {
    $conductor = $run->get('conductor_id')->entity;
    if (!$conductor instanceof BbConductorInterface) {
      return FALSE;
    }
    return $conductor->isOwnedBy($account);
  }

}
