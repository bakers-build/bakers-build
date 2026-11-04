<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Plugin\tool\Tool;

use Drupal\Core\Access\AccessException;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Plugin\tool\Tool\TicketInputTrait;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\bb_inbox\InboxRejected;
use Drupal\bb_inbox\InboxSender;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\OutputDefinition;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Sends an inbox message for a ticket and waits a bounded time for its answer.
 */
#[Tool(
  id: 'bakers_inbox_send',
  label: new TranslatableMarkup('Send an inbox message'),
  description: new TranslatableMarkup("Sends a named message (e.g. ports.tunnel) to a ticket's conductor under the same access and payload rules as the web UI, then waits up to 30 s for the answer. Without an answer by then it returns the message id with status pending; read it later with bakers_inbox_read."),
  operation: ToolOperation::Write,
  destructive: FALSE,
  permission: 'view bb_ticket',
  input_definitions: [
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'message' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Message'),
      description: new TranslatableMarkup('The namespaced message type, e.g. ports.tunnel.'),
      constraints: ['NotBlank' => []],
    ),
    'payload' => new InputDefinition(
      data_type: 'map',
      label: new TranslatableMarkup('Payload'),
      description: new TranslatableMarkup("The message's input as a JSON object; omit for a message without input."),
      required: FALSE,
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
      description: new TranslatableMarkup('pending, running, done or failed; failed is an answer, not a refusal.'),
    ),
    'markdown' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Answer'),
      description: new TranslatableMarkup('The Markdown answer; empty until done or failed.'),
    ),
  ],
)]
final class InboxSend extends ToolBase {

  use TicketInputTrait;

  /**
   * The web UI's send path.
   */
  private InboxSender $sender;

  /**
   * How long to wait for the conductor's answer.
   */
  private int $waitSeconds = 30;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->sender = $container->get('bb_inbox.sender');
    $wait = $container->getParameter('bb_inbox.send_wait_seconds');
    if (is_numeric($wait)) {
      $instance->waitSeconds = (int) $wait;
    }
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $ticket = $this->readableTicket($values['ticket']);
    try {
      $message = $this->sender->send($ticket, $values['message'], $values['payload'] ?? [], $this->currentUser);
    }
    catch (InboxRejected | AccessException $e) {
      throw new \InvalidArgumentException($e->getMessage(), 0, $e);
    }
    $storage = $this->entities()->getStorage('bb_inbox_message');
    for ($second = 0; $second < $this->waitSeconds && !self::answered($message); $second++) {
      sleep(1);
      $storage->resetCache([$message->id()]);
      $fresh = $storage->load($message->id());
      assert($fresh instanceof BbInboxMessageInterface);
      $message = $fresh;
    }
    return ExecutableResult::success(new TranslatableMarkup('Message @status.', ['@status' => $message->status()]), InboxRead::outputs($message));
  }

  /**
   * Whether the conductor answered the message.
   */
  private static function answered(BbInboxMessageInterface $message): bool {
    return in_array($message->status(), [BbInboxMessageInterface::STATUS_DONE, BbInboxMessageInterface::STATUS_FAILED], TRUE);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Ticket and message access depend on the values; the sender checks both.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
