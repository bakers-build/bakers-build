<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityHandlerInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Adds session-scoped write access on top of the entity-module handler.
 */
final class BbTicketAccessControlHandler extends EntityAccessControlHandler implements EntityHandlerInterface {

  /**
   * Fields the server derives, writable by nobody at any point.
   *
   * @var array<string>
   */
  private const SERVER_DERIVED_FIELDS = [
    'identifier',
    'number',
    'base_branch',
    'target_branch',
    'frozen_at',
    'restarted_at',
    'restarted_by',
    'template_id',
  ];

  /**
   * Fields still writable on a closed ticket, keyed by `cleaned_up`.
   *
   * The reaper's cleanup fields.
   *
   * @var array<int, array<string>>
   */
  private const CLOSED_WRITABLE_FIELDS = [
    0 => ['cleaned_up', 'metrics'],
    1 => ['cleaned_up'],
  ];

  /**
   * Constructs a BbTicketAccessControlHandler.
   *
   * @param \Drupal\Core\Entity\EntityTypeInterface $entity_type
   *   The entity type definition.
   * @param \Drupal\bb_core\Access\BbWriteScope $writeScope
   *   The write-scope resolver for session-scoped ticket access.
   */
  public function __construct(
    EntityTypeInterface $entity_type,
    private readonly BbWriteScope $writeScope,
  ) {
    parent::__construct($entity_type);
  }

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): static {
    return new static(
      $entity_type,
      $container->get('bb_core.write_scope'),
    );
  }

  /**
   * Grants update access when the ticket is within the account's write scope.
   *
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    $result = parent::checkAccess($entity, $operation, $account);
    if ($operation === 'update' && !$result->isAllowed() && $account->hasPermission('write bakers via session scope')) {
      if ($this->writeScope->isTicketInScope($account, (int) $entity->id())) {
        return AccessResult::allowed()->setCacheMaxAge(0)->cachePerUser();
      }
      // A terminal ticket may still be wound up outside any run scope: a done
      // one closed, a cancelled one reaped, and an already closed
      // one may still need its infrastructure cleanup acknowledged.
      // checkFieldAccess narrows the permitted fields for each case.
      if ($this->isTerminal($entity)
        || ($entity instanceof BbTicketInterface && $entity->isClosed())) {
        return AccessResult::allowed()
          ->setCacheMaxAge(0)
          ->cachePerUser()
          ->addCacheableDependency($entity);
      }
      return AccessResult::neutral()->setCacheMaxAge(0)->cachePerUser();
    }
    return $result;
  }

  /**
   * Dispatches the per-field gates; every other field defers to the parent.
   *
   * Assignment uses ticket update access and terminal cleanup retains its own
   * restriction; server-derived fields remain unwritable.
   *
   * {@inheritdoc}
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResultInterface {
    $derived = $this->checkServerDerivedFieldAccess($operation, $field_definition, $items);
    if ($derived !== NULL) {
      return $derived;
    }
    $locked = $this->checkClosedTicketFieldAccess($operation, $field_definition, $account, $items);
    if ($locked !== NULL) {
      return $locked;
    }
    $closure = $this->checkDoneClosureFieldAccess($operation, $field_definition, $account, $items);
    if ($closure !== NULL) {
      return $closure;
    }
    $named = $this->checkNamedFieldAccess($operation, $field_definition, $account, $items);
    if ($named !== NULL) {
      return $named;
    }
    return parent::checkFieldAccess($operation, $field_definition, $account, $items);
  }

  /**
   * Per-field gates that name one field: assignment, freeze, recipient profile.
   *
   * @param string $operation
   *   The field operation, `view` or `edit`.
   * @param \Drupal\Core\Field\FieldDefinitionInterface $field_definition
   *   The field being accessed.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account attempting the access.
   * @param \Drupal\Core\Field\FieldItemListInterface|null $items
   *   The field values, or NULL when the entity is unsaved.
   *
   * @return \Drupal\Core\Access\AccessResultInterface|null
   *   The named field's result, or NULL to fall through.
   */
  private function checkNamedFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items): ?AccessResultInterface {
    if ($items === NULL) {
      return NULL;
    }
    $name = $field_definition->getName();
    if ($operation === 'edit' && $name === 'conductor_id') {
      return $this->checkConductorIdFieldAccess($account, $items->getEntity());
    }
    if ($operation === 'edit' && $name === 'frozen') {
      return $this->checkFrozenFieldAccess($account, $items->getEntity());
    }
    if ($operation === 'view' && $name === 'recipient_profile') {
      return $this->checkRecipientProfileFieldAccess($account, $items->getEntity());
    }
    return NULL;
  }

  /**
   * Restricts `recipient_profile` reads to the ticket's own assignee.
   *
   * The field is computed for the assignee's onboarding profile specifically,
   * so nobody else has business reading it — not even an account
   * with full ticket view access.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account attempting the read.
   * @param \Drupal\Core\Entity\EntityInterface $ticket
   *   The ticket carrying the field.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   Allowed only when the account is the ticket's assignee.
   */
  private function checkRecipientProfileFieldAccess(AccountInterface $account, EntityInterface $ticket): AccessResultInterface {
    $assignee_id = $ticket instanceof BbTicketInterface ? $ticket->get('assignee_user_id')->target_id : NULL;
    $is_assignee = is_numeric($assignee_id) && (int) $assignee_id > 0 && (int) $assignee_id === (int) $account->id();
    return AccessResult::allowedIf($is_assignee)
      ->cachePerUser()
      ->addCacheableDependency($ticket);
  }

  /**
   * Uses ordinary ticket update access for assignment, also during creation.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account attempting the write, scoped by the field fence on re-entry.
   * @param \Drupal\Core\Entity\EntityInterface $ticket
   *   The saved or unsaved ticket being assigned.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   The existing ticket edit result, with a useful reason when denied.
   */
  private function checkConductorIdFieldAccess(AccountInterface $account, EntityInterface $ticket): AccessResultInterface {
    $access = $this->checkAccess($ticket, 'update', $account);
    if ($access->isAllowed()) {
      return $access;
    }
    return AccessResult::forbidden('Assigning a conductor requires permission to edit this ticket in its project or workspace.')
      ->addCacheableDependency($access);
  }

  /**
   * Uses ordinary ticket update access for freeze, also during creation.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account attempting the write.
   * @param \Drupal\Core\Entity\EntityInterface $ticket
   *   The saved or unsaved ticket being frozen or unfrozen.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   The existing ticket edit result, with a useful reason when denied.
   */
  private function checkFrozenFieldAccess(AccountInterface $account, EntityInterface $ticket): AccessResultInterface {
    $access = $this->checkAccess($ticket, 'update', $account);
    if ($access->isAllowed()) {
      return $access;
    }
    return AccessResult::forbidden('Freezing a ticket requires permission to edit this ticket in its project or workspace.')
      ->addCacheableDependency($access);
  }

  /**
   * Denies writes to the fields the server derives — admins included.
   *
   * `identifier`, `number` and `base_branch` are derived (number allocation in
   * preSave, base_branch on read), so a client write is wrong for every actor.
   * `branch_name` stays settable while the ticket is new, which is how a
   * release ticket carries its integration branch, and freezes afterwards.
   * JSON:API PATCH consults field access alone, so the denial names the field;
   * server-side saves are unaffected.
   *
   * @param string $operation
   *   The field operation.
   * @param \Drupal\Core\Field\FieldDefinitionInterface $field_definition
   *   The field being accessed.
   * @param \Drupal\Core\Field\FieldItemListInterface|null $items
   *   The field items, carrying the ticket entity when one is in context.
   *
   * @return \Drupal\Core\Access\AccessResultInterface|null
   *   Forbidden for a derived field, or NULL when this gate does not apply and
   *   the field should defer to the parent handler.
   */
  private function checkServerDerivedFieldAccess(string $operation, FieldDefinitionInterface $field_definition, ?FieldItemListInterface $items): ?AccessResultInterface {
    if ($operation !== 'edit') {
      return NULL;
    }
    $name = $field_definition->getName();
    if (in_array($name, self::SERVER_DERIVED_FIELDS, TRUE)) {
      return AccessResult::forbidden(sprintf('The %s field is derived by the server and cannot be written.', $name));
    }
    if ($name !== 'branch_name') {
      return NULL;
    }
    // Without an entity in context there is no create/update to tell apart,
    // so leave the decision to the parent handler rather than guess — the same
    // guard core applies before its own ID/UUID checks.
    $ticket = $items?->getEntity();
    if (!$ticket instanceof BbTicketInterface || $ticket->isNew()) {
      return NULL;
    }
    return AccessResult::forbidden('The branch name is frozen once the ticket exists.')
      ->addCacheableDependency($ticket);
  }

  /**
   * Restricts out-of-scope terminal-ticket writes to the closed-writable ones.
   *
   * On ANY terminal ticket written OUTSIDE any active run's scope — `done`,
   * `cancelled`, or any other no-exit state a workflow declares — a
   * session-scoped writer may only touch `cleaned_up`, and `metrics` until
   * teardown (isClosedWritable()). `closed`,
   * `closed_date` and `cleaned_up_date` are stamped by BbTicket::preSave(),
   * so no client writes them. In-scope run writes are unaffected and defer to
   * the parent handler.
   * Pairs with the terminal-ticket grant in checkAccess().
   *
   * @param string $operation
   *   The field operation.
   * @param \Drupal\Core\Field\FieldDefinitionInterface $field_definition
   *   The field being written.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account attempting the write.
   * @param \Drupal\Core\Field\FieldItemListInterface|null $items
   *   The field items, carrying the ticket entity.
   *
   * @return \Drupal\Core\Access\AccessResultInterface|null
   *   An access result when the cleanup grant applies, or NULL when this gate
   *   does not apply and the write should defer to the parent handler.
   */
  private function checkDoneClosureFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items): ?AccessResultInterface {
    $ticket = $items?->getEntity();
    if (!$this->isTerminalCleanupContext($operation, $account, $ticket)) {
      return NULL;
    }
    assert($ticket instanceof BbTicketInterface);
    if (!$this->isClosedWritable($field_definition, $ticket)) {
      return AccessResult::forbidden('A terminal ticket may only receive its cleanup fields outside a run scope.')
        ->setCacheMaxAge(0)
        ->cachePerUser()
        ->addCacheableDependency($ticket);
    }
    return AccessResult::allowed()
      ->setCacheMaxAge(0)
      ->cachePerUser()
      ->addCacheableDependency($ticket);
  }

  /**
   * Freezes a closed ticket: no field may be edited, whoever asks.
   *
   * Keyed on the stored `closed` flag, not the in-memory state, so an illegal
   * transition into a terminal state still fails validation. `cleaned_up`
   * (and `metrics` until teardown) stays writable for the reaper. An account
   * with `administer bakers` may edit `state` while the current state is still
   * non-terminal, so a legacy closed intermediate row can be corrected; the
   * save then cancels it.
   *
   * @return \Drupal\Core\Access\AccessResultInterface|null
   *   Forbidden for every other field of a closed ticket; NULL otherwise.
   */
  private function checkClosedTicketFieldAccess(string $operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items): ?AccessResultInterface {
    $ticket = $items?->getEntity();
    if ($operation !== 'edit' || !$ticket instanceof BbTicketInterface || $ticket->isNew()
      || !$ticket->isClosed()
      || $this->isClosedWritable($field_definition, $ticket)) {
      return NULL;
    }
    if ($field_definition->getName() === 'state'
      && $account->hasPermission('administer bakers')
      && !$this->isTerminal($ticket)) {
      return NULL;
    }
    return AccessResult::forbidden('A closed ticket can no longer be edited.')->addCacheableDependency($ticket);
  }

  /**
   * Whether this field is still writable on a closed ticket.
   *
   * `cleaned_up` always; `metrics` only until teardown, so
   * the reaper can record the merge-request measurement first.
   */
  private function isClosedWritable(FieldDefinitionInterface $field_definition, BbTicketInterface $ticket): bool {
    return in_array($field_definition->getName(), self::CLOSED_WRITABLE_FIELDS[(int) $ticket->isCleanedUp()], TRUE);
  }

  /**
   * Whether an out-of-scope terminal cleanup restriction applies.
   */
  private function isTerminalCleanupContext(string $operation, AccountInterface $account, ?EntityInterface $ticket): bool {
    if ($operation !== 'edit') {
      return FALSE;
    }
    if ($account->hasPermission('administer bakers')
      || !$account->hasPermission('write bakers via session scope')) {
      return FALSE;
    }
    if (!$ticket instanceof BbTicketInterface || (int) $ticket->id() <= 0) {
      return FALSE;
    }
    if (!$this->isTerminal($ticket) && !$ticket->isClosed()) {
      return FALSE;
    }
    return !$this->writeScope->isTicketInScope($account, (int) $ticket->id());
  }

  /**
   * Whether the ticket sits in a terminal workflow state.
   *
   * The GRANT predicate for the out-of-scope wind-up. Terminality is derived
   * from bb_core.workflows.yml — a state no transition leaves — so
   * `cancelled` counts alongside `done` and a workflow that gains another
   * terminal state is covered without touching this handler. Deliberately not a
   * hardcoded state list, which would be a second source of truth beside the
   * workflow definition and would go stale silently.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The ticket entity to inspect.
   *
   * @return bool
   *   TRUE when the ticket's state is terminal in its own workflow.
   */
  private function isTerminal(EntityInterface $entity): bool {
    if (!$entity instanceof BbTicketInterface) {
      return FALSE;
    }
    $workflow = $entity->getWorkflow();
    if ($workflow === '') {
      return FALSE;
    }
    return TypeWorkflows::isTerminal($workflow, (string) $entity->get('state')->value);
  }

  /**
   * Grants create access to accounts with the session-scoped write permission.
   *
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    $result = parent::checkCreateAccess($account, $context, $entity_bundle);
    if (!$result->isAllowed() && $account->hasPermission('write bakers via session scope')) {
      return AccessResult::allowed()->cachePerPermissions();
    }
    return $result;
  }

}
