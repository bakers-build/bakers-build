<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\TicketWriteBudget;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Publishes one typed Markdown comment on a ticket.
 */
#[Tool(
  id: 'bakers_comment_publish',
  label: new TranslatableMarkup('Publish a ticket comment'),
  description: new TranslatableMarkup('Stores a Markdown comment of the given type (plan, spec, summary, …) on a ticket. The create response is the confirmation.'),
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
    'type' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Comment type'),
      description: new TranslatableMarkup('The bb_comment_type, e.g. comment, plan, spec, test, acceptance, summary, qualification.'),
      constraints: ['NotBlank' => [], 'Length' => ['max' => 64]],
    ),
    'body' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Body'),
      description: new TranslatableMarkup('Markdown source; raw HTML is stripped.'),
      constraints: ['NotBlank' => [], 'Regex' => ['pattern' => '/\\S/'], 'MediaType' => ['type' => 'text/markdown']],
    ),
  ],
  output_definitions: [
    'id' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Comment UUID'),
      description: new TranslatableMarkup('The new comment.'),
    ),
    'type' => new OutputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Stored type'),
      description: new TranslatableMarkup('The comment type as stored.'),
    ),
  ],
)]
final class CommentPublish extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $ticket = $this->readableTicket($values['ticket']);
    $storage = $this->entities()->getStorage('bb_comment');
    if (!$this->entities()->getAccessControlHandler('bb_comment')->createAccess('bb_comment', $this->currentUser)) {
      throw new \InvalidArgumentException('You may not comment on tickets.');
    }
    TicketWriteBudget::check($values['body'], $values['type']);
    $comment = $storage->create([
      'ticket_id' => $ticket->id(),
      'type' => $values['type'],
      'body' => ['value' => $values['body'], 'format' => 'bb_rich'],
    ]);
    assert($comment instanceof BbCommentInterface);
    $this->assertValid($comment);
    $comment->save();
    return ExecutableResult::success(new TranslatableMarkup('Comment published.'), [
      'id' => $comment->uuid(),
      'type' => $comment->get('type')->value,
    ]);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Ticket and comment access depend on the values; doExecute() checks both.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
