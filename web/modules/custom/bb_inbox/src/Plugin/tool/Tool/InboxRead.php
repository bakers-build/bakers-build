<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Plugin\tool\Tool\TicketInputTrait;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Reads an inbox message's status and answer.
 */
#[Tool(
  id: 'bakers_inbox_read',
  label: new TranslatableMarkup('Read an inbox message'),
  description: new TranslatableMarkup('Returns the status (pending, running, done, failed) and Markdown answer of a message sent with bakers_inbox_send, without waiting.'),
  operation: ToolOperation::Read,
  destructive: FALSE,
  permission: 'view bb_ticket',
  input_definitions: [
    'message' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Message'),
      description: new TranslatableMarkup('The message UUID bakers_inbox_send returned.'),
      constraints: ['NotBlank' => []],
    ),
  ],
  output_definitions: [
    'id' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Message UUID'),
      description: new TranslatableMarkup('The message.'),
    ),
    'status' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Status'),
      description: new TranslatableMarkup('pending, running, done or failed.'),
    ),
    'markdown' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Answer'),
      description: new TranslatableMarkup('The Markdown answer; empty until done or failed.'),
    ),
  ],
)]
final class InboxRead extends ToolBase {

  use TicketInputTrait;

  /**
   * The outputs for a message; bakers_inbox_send returns the same.
   *
   * @return array{id: string, status: string, markdown: string}
   *   Outputs keyed by name.
   */
  public static function outputs(BbInboxMessageInterface $message): array {
    return [
      'id' => (string) $message->uuid(),
      'status' => $message->status(),
      'markdown' => (string) ($message->result()['markdown'] ?? ''),
    ];
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $found = $this->entities()->getStorage('bb_inbox_message')->loadByProperties(['uuid' => $values['message']]);
    $message = reset($found);
    // One wording for unknown and unreadable, so existence does not leak.
    if (!$message instanceof BbInboxMessageInterface || !$message->access('view', $this->currentUser)) {
      throw new \InvalidArgumentException(sprintf('Message %s not found.', $values['message']));
    }
    return ExecutableResult::success(new TranslatableMarkup('Message @status.', ['@status' => $message->status()]), self::outputs($message));
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Access depends on the message; doExecute() checks it.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
