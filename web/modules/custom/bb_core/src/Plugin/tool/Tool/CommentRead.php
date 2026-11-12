<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListInputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Reads the comments of one ticket that match the given filters.
 */
#[Tool(
  id: 'bakers_comment_read',
  label: new TranslatableMarkup('Read ticket comments'),
  description: new TranslatableMarkup('Returns a ticket’s readable comments in full, oldest first, filtered by ids, types, authors and the newest; the filters combine with AND, none returns all.'),
  operation: ToolOperation::Read,
  permission: 'view bb_ticket',
  input_definitions: [
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'ids' => new ListInputDefinition(
      label: new TranslatableMarkup('IDs'),
      description: new TranslatableMarkup('Comment UUIDs.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('ID'),
        description: new TranslatableMarkup('One comment UUID.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'type' => new ListInputDefinition(
      label: new TranslatableMarkup('Types'),
      description: new TranslatableMarkup('Comment types, e.g. spec or plan.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Type'),
        description: new TranslatableMarkup('One comment type.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'author' => new ListInputDefinition(
      label: new TranslatableMarkup('Authors'),
      description: new TranslatableMarkup('Author display names.'),
      required: FALSE,
      item_definition: new InputDefinition(
        data_type: 'string',
        label: new TranslatableMarkup('Author'),
        description: new TranslatableMarkup('One author display name.'),
        constraints: ['NotBlank' => []],
      ),
    ),
    'newest' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Newest'),
      description: new TranslatableMarkup('Only the newest N matching comments, 1 or more; per type when type is given.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'comments' => new ListOutputDefinition(
      label: new TranslatableMarkup('Comments'),
      description: new TranslatableMarkup('The matching readable comments, oldest first.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Comment'),
        description: new TranslatableMarkup('One comment.'),
        property_definitions: [
          'id' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The comment UUID.'),
          ),
          'type' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Type'),
            description: new TranslatableMarkup('The comment type, e.g. plan or spec.'),
          ),
          'body' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Body'),
            description: new TranslatableMarkup('The Markdown body.'),
            constraints: ['MediaType' => ['type' => 'text/markdown']],
          ),
          'created' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Created'),
            description: new TranslatableMarkup('ISO 8601 creation time.'),
          ),
          'author' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Author'),
            description: new TranslatableMarkup('The author’s display name.'),
          ),
        ],
      ),
    ),
  ],
)]
final class CommentRead extends ToolBase {

  use TicketInputTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $ticket = $this->readableTicket($values['ticket']);
    $newest = isset($values['newest']) ? (int) $values['newest'] : NULL;
    if ($newest !== NULL && $newest < 1) {
      throw new \InvalidArgumentException('newest must be 1 or more.');
    }
    $types = $values['type'] ?? [];
    // The newest N apply per type: one bounded query per type.
    $groups = $newest !== NULL && $types ? array_map(static fn ($type): array => [$type], $types) : [$types];
    $ids = [];
    foreach ($groups as $group) {
      $query = $this->matching($ticket, $values, $group);
      if ($newest !== NULL) {
        $query->sort('created', 'DESC')->sort('id', 'DESC')->range(0, $newest);
      }
      $ids += $query->execute();
    }
    $storage = $this->entities()->getStorage('bb_comment');
    $sorted = $ids ? $storage->getQuery()->accessCheck(TRUE)->condition('id', $ids, 'IN')->sort('created')->sort('id')->execute() : [];
    $comments = [];
    foreach ($storage->loadMultiple($sorted) as $comment) {
      assert($comment instanceof ContentEntityInterface);
      $comments[] = $this->commentItem($comment);
    }
    return ExecutableResult::success(new TranslatableMarkup('Comments read.'), ['comments' => $comments]);
  }

  /**
   * The access-checked query of the ticket's comments matching the filters.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param array<string, mixed> $values
   *   The tool inputs.
   * @param array<string> $types
   *   The comment types; none matches every type.
   */
  private function matching(BbTicketInterface $ticket, array $values, array $types): QueryInterface {
    $query = $this->entities()->getStorage('bb_comment')->getQuery()->accessCheck(TRUE)
      ->condition('ticket_id', $ticket->id());
    if ($types) {
      $query->condition('type', $types, 'IN');
    }
    if (!empty($values['ids'])) {
      $query->condition('uuid', $values['ids'], 'IN');
    }
    if (!empty($values['author'])) {
      // shortcut: matches the account name, the display name unless a
      // module alters it; resolve labels if one does.
      $query->condition('author.entity:user.name', $values['author'], 'IN');
    }
    return $query;
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
