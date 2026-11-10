<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\RunLog\RunLogException;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\tool\Attribute\Tool;
use Drupal\tool\ExecutableResult;
use Drupal\tool\Tool\ToolBase;
use Drupal\tool\Tool\ToolOperation;
use Drupal\tool\TypedData\InputDefinition;
use Drupal\tool\TypedData\ListOutputDefinition;
use Drupal\tool\TypedData\MapOutputDefinition;
use Drupal\tool\TypedData\OutputDefinition;

/**
 * Lists a readable ticket's viewable runs, newest first, with why they failed.
 */
#[Tool(
  id: 'bakers_ticket_runs_list',
  label: new TranslatableMarkup('List ticket runs'),
  description: new TranslatableMarkup('Lists the runs of a ticket you can view, newest first: state, the ticket state the run started in, agent, conductor, start time, whether the run is closed and why it failed.'),
  operation: ToolOperation::Read,
  permission: 'view bb_run',
  input_definitions: [
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID.'),
      constraints: ['NotBlank' => []],
    ),
    'limit' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Limit'),
      description: new TranslatableMarkup('Rows per page, 1-100; default 50.'),
      required: FALSE,
    ),
    'offset' => new InputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Offset'),
      description: new TranslatableMarkup('Rows to skip; default 0.'),
      required: FALSE,
    ),
  ],
  output_definitions: [
    'runs' => new ListOutputDefinition(
      label: new TranslatableMarkup('Runs'),
      description: new TranslatableMarkup('The ticket’s viewable runs.'),
      item_definition: new MapOutputDefinition(
        label: new TranslatableMarkup('Run'),
        description: new TranslatableMarkup('One run.'),
        property_definitions: [
          'uuid' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('UUID'),
            description: new TranslatableMarkup('The run UUID.'),
          ),
          'state' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('State'),
            description: new TranslatableMarkup('The run state, e.g. running or done.'),
          ),
          'state_at_start' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('State at start'),
            description: new TranslatableMarkup('The ticket state the run started in.'),
            nullable: TRUE,
          ),
          'agent' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Agent'),
            description: new TranslatableMarkup('The agent that ran.'),
            nullable: TRUE,
          ),
          'conductor' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Conductor'),
            description: new TranslatableMarkup('The conductor UUID.'),
            nullable: TRUE,
          ),
          'started_at' => new OutputDefinition(
            data_type: 'integer',
            label: new TranslatableMarkup('Started at'),
            description: new TranslatableMarkup('Unix time the run started.'),
            nullable: TRUE,
          ),
          'closed' => new OutputDefinition(
            data_type: 'boolean',
            label: new TranslatableMarkup('Closed'),
            description: new TranslatableMarkup('Whether the run is fully wound up.'),
          ),
          'error_log' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Error log'),
            description: new TranslatableMarkup('Why the run failed, e.g. what a conductor restart did to it; empty otherwise.'),
            nullable: TRUE,
          ),
        ],
      ),
    ),
    'next_offset' => new OutputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Next offset'),
      description: new TranslatableMarkup('The offset of the next page, or null on the last page.'),
      nullable: TRUE,
    ),
  ],
)]
final class TicketRunsList extends ToolBase {

  use TicketInputTrait;
  use PagedQueryTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $ticket = $this->readableTicket($values['ticket']);
    $storage = $this->entities()->getStorage('bb_run');
    $query = $storage->getQuery()->accessCheck(TRUE)->condition('ticket_id', $ticket->id())->sort('id', 'DESC');
    [$ids, $next] = $this->page($query, $values);
    $runs = [];
    foreach ($storage->loadMultiple($ids) as $run) {
      assert($run instanceof BbRunInterface);
      if (!$run->access('view', $this->currentUser)) {
        continue;
      }
      $started = $run->get('started_at')->value;
      $runs[] = [
        'uuid' => $run->uuid(),
        'state' => (string) $run->get('state')->value,
        'state_at_start' => $run->get('state_at_start')->value,
        'agent' => $run->get('agent')->value,
        'conductor' => $run->get('conductor_id')->entity?->uuid(),
        'started_at' => $started === NULL ? NULL : (int) $started,
        'closed' => (bool) $run->get('closed')->value,
        'error_log' => $this->errorLog($run),
      ];
    }
    return ExecutableResult::success(new TranslatableMarkup('@count runs found.', ['@count' => count($runs)]), [
      'runs' => $runs,
      'next_offset' => $next,
    ]);
  }

  /**
   * The run's failure detail, at most 2000 characters; NULL when unreadable.
   */
  private function errorLog(BbRunInterface $run): ?string {
    try {
      $log = $run->readErrorLog();
    }
    catch (RunLogException) {
      return NULL;
    }
    return $log === NULL ? NULL : mb_substr($log, 0, 2000);
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // The access-checked queries and entity access in doExecute() decide.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
