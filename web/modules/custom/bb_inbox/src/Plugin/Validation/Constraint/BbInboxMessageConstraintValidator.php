<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\bb_inbox\Event\InboxMessageEvent;
use Drupal\bb_inbox\MessageContractValidator;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Contracts\EventDispatcher\EventDispatcherInterface;

/**
 * Asks the responsible handler and enforces the inbox's own rules.
 *
 * Runs on create and on every status or result change, so every write path
 * (sender service, resource, generic JSON:API) meets the same rules.
 */
final class BbInboxMessageConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Allowed status moves.
   */
  private const TRANSITIONS = [
    BbInboxMessageInterface::STATUS_PENDING => [
      BbInboxMessageInterface::STATUS_RUNNING,
      BbInboxMessageInterface::STATUS_DONE,
      BbInboxMessageInterface::STATUS_FAILED,
    ],
    BbInboxMessageInterface::STATUS_RUNNING => [
      BbInboxMessageInterface::STATUS_DONE,
      BbInboxMessageInterface::STATUS_FAILED,
    ],
  ];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly EventDispatcherInterface $dispatcher,
    private readonly AccountInterface $currentUser,
    private readonly MessageContractValidator $contract,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('entity_type.manager'),
      $container->get('event_dispatcher'),
      $container->get('current_user'),
      $container->get('bb_inbox.message_contract_validator'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    if (!$value instanceof BbInboxMessageInterface) {
      return;
    }
    $op = $this->operation($value);
    if ($op === NULL) {
      return;
    }
    if (!$this->hasValidJson($value)) {
      return;
    }
    if ($op === InboxMessageEvent::OP_CREATE && $value->conductor() === NULL) {
      $this->context->addViolation('The ticket has no conductor.');
      return;
    }
    if ($op === InboxMessageEvent::OP_RESULT && !$this->hasValidResultWrite($value)) {
      return;
    }
    $this->askHandler($value, $op);
  }

  /**
   * Create for a new message, result for a status/result change, else NULL.
   */
  private function operation(BbInboxMessageInterface $message): ?string {
    if ($message->isNew()) {
      return InboxMessageEvent::OP_CREATE;
    }
    $original = $this->entityTypeManager->getStorage('bb_inbox_message')
      ->loadUnchanged($message->id());
    if (!$original instanceof BbInboxMessageInterface) {
      return NULL;
    }
    $changed = $original->status() !== $message->status()
      || $original->get('result')->value !== $message->get('result')->value;
    return $changed ? InboxMessageEvent::OP_RESULT : NULL;
  }

  /**
   * Payload must be a JSON object; result, when set, too.
   */
  private function hasValidJson(BbInboxMessageInterface $message): bool {
    $valid = TRUE;
    foreach (['payload', 'result'] as $field) {
      $raw = $message->get($field)->value;
      if ($raw === NULL || ($field === 'result' && $raw === '')) {
        continue;
      }
      $decoded = json_decode((string) $raw);
      if (!$decoded instanceof \stdClass) {
        $this->context->addViolation('The @field is not a JSON object.', ['@field' => $field]);
        $valid = FALSE;
      }
    }
    return $valid;
  }

  /**
   * Status moves forward and terminal results have their required shape.
   */
  private function hasValidResultWrite(BbInboxMessageInterface $message): bool {
    $original = $this->entityTypeManager->getStorage('bb_inbox_message')
      ->loadUnchanged($message->id());
    assert($original instanceof BbInboxMessageInterface);
    $from = $original->status();
    $to = $message->status();
    if (!in_array($to, self::TRANSITIONS[$from] ?? [], TRUE)) {
      $this->context->addViolation('The status cannot move from @from to @to.', ['@from' => $from, '@to' => $to]);
      return FALSE;
    }
    if (!in_array($to, [BbInboxMessageInterface::STATUS_DONE, BbInboxMessageInterface::STATUS_FAILED], TRUE)) {
      return TRUE;
    }
    // Both terminal results follow message-result.v2: exactly {markdown}.
    $result = json_decode((string) $message->get('result')->value);
    if (!$result instanceof \stdClass) {
      $this->context->addViolation('A @status message needs a result.', ['@status' => $to]);
      return FALSE;
    }
    $errors = $this->contract->validateResult($result);
    foreach ($errors as $error) {
      $this->context->addViolation('result.@error', ['@error' => $error]);
    }
    return $errors === [];
  }

  /**
   * Dispatches the event and turns its outcome into violations.
   */
  private function askHandler(BbInboxMessageInterface $message, string $op): void {
    $requester = $message->get('requested_by')->entity;
    $account = $op === InboxMessageEvent::OP_CREATE && $requester instanceof UserInterface
      ? $requester
      : $this->currentUser;
    $event = new InboxMessageEvent($message, $op, $account);
    $this->dispatcher->dispatch($event, InboxMessageEvent::NAME);
    if (!$event->isClaimed()) {
      // A message whose handler is gone can still be failed, or it would stay
      // pending forever and be retried every tick.
      if ($op === InboxMessageEvent::OP_RESULT && $message->status() === BbInboxMessageInterface::STATUS_FAILED) {
        return;
      }
      $this->context->addViolation('no handler for message @id', ['@id' => $message->messageId()]);
      return;
    }
    if ($op === InboxMessageEvent::OP_CREATE) {
      $message->set('version', $event->version());
      if ($event->denied() !== NULL) {
        $this->context->addViolation('@reason', ['@reason' => $event->denied()]);
      }
    }
    foreach ($event->vetoes() as $reason) {
      $this->context->addViolation('@reason', ['@reason' => $reason]);
    }
  }

}
