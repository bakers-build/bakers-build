<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Ticket\TicketInterventions;
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
 * Lists a readable ticket's viewable runs, newest first, without their logs.
 *
 * With restartable: the runs Restart runs would cancel on a ticket, machine or
 * conductor, grouped by ticket.
 */
#[Tool(
  id: 'bakers_run_list',
  label: new TranslatableMarkup('List ticket runs'),
  description: new TranslatableMarkup('Lists the runs of a ticket you can view, newest first: state, the ticket state the run started in, agent, conductor, start time, whether the run is closed, run number and ticket. With restartable: only the runs Restart runs would cancel, all on one page and grouped by ticket: each open, unfrozen ticket’s claimed or running runs and its newest run when that failed. Then machine_id or conductor list the runs on your machine or your machine’s conductor (another owner’s look empty); a ticket lists its runs when you may restart it. Cancel the chosen ones with bakers_run_cancel runs.'),
  operation: ToolOperation::Read,
  permission: 'view bb_run',
  input_definitions: [
    'ticket' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Ticket'),
      description: new TranslatableMarkup('Ticket identifier (e.g. BAKERS-15) or UUID. Give exactly one of ticket, machine_id or conductor.'),
      required: FALSE,
    ),
    'machine_id' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Machine ID'),
      description: new TranslatableMarkup('The machine_id of one of your machines; needs restartable.'),
      required: FALSE,
    ),
    'conductor' => new InputDefinition(
      data_type: 'string',
      label: new TranslatableMarkup('Conductor'),
      description: new TranslatableMarkup('Conductor UUID; needs restartable.'),
      required: FALSE,
    ),
    'restartable' => new InputDefinition(
      data_type: 'boolean',
      label: new TranslatableMarkup('Restartable'),
      description: new TranslatableMarkup('List only the runs Restart runs would cancel, without paging.'),
      required: FALSE,
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
      description: new TranslatableMarkup('The viewable runs, or with restartable the restartable runs.'),
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
          'number' => new OutputDefinition(
            data_type: 'integer',
            label: new TranslatableMarkup('Number'),
            description: new TranslatableMarkup('The run number.'),
          ),
          'ticket' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Ticket'),
            description: new TranslatableMarkup('The ticket identifier.'),
          ),
          'ticket_title' => new OutputDefinition(
            data_type: 'string',
            label: new TranslatableMarkup('Ticket title'),
            description: new TranslatableMarkup('The ticket title.'),
          ),
        ],
      ),
    ),
    'next_offset' => new OutputDefinition(
      data_type: 'integer',
      label: new TranslatableMarkup('Next offset'),
      description: new TranslatableMarkup('The offset of the next page, or null on the last page and with restartable.'),
      nullable: TRUE,
    ),
  ],
)]
final class RunList extends ToolBase {

  use TicketInputTrait;
  use PagedQueryTrait;

  /**
   * {@inheritdoc}
   */
  protected function doExecute(array $values): ExecutableResult {
    $ticket_input = (string) ($values['ticket'] ?? '');
    $machine = (string) ($values['machine_id'] ?? '');
    $conductor = (string) ($values['conductor'] ?? '');
    if (count(array_filter([$ticket_input, $machine, $conductor], static fn (string $value): bool => $value !== '')) !== 1) {
      throw new \InvalidArgumentException('Give exactly one of ticket, machine_id or conductor.');
    }
    if (empty($values['restartable'])) {
      if ($ticket_input === '') {
        throw new \InvalidArgumentException('machine_id and conductor list restartable runs only; set restartable.');
      }
      return $this->ticketRuns($ticket_input, $values);
    }
    $runs = match (TRUE) {
      $machine !== '' => $this->machineRuns($machine),
      $conductor !== '' => $this->conductorRuns($conductor),
      default => $this->restartableTicketRuns($ticket_input),
    };
    $rows = [];
    foreach (TicketInterventions::byTicket($runs) as $group) {
      foreach ($group as $run) {
        $rows[] = $this->row($run);
      }
    }
    return ExecutableResult::success(new TranslatableMarkup('@count runs found.', ['@count' => count($rows)]), [
      'runs' => $rows,
      'next_offset' => NULL,
    ]);
  }

  /**
   * One page of the ticket's viewable runs, newest first.
   *
   * @param string $input
   *   The ticket identifier or UUID.
   * @param array<string, mixed> $values
   *   The tool input, for paging.
   */
  private function ticketRuns(string $input, array $values): ExecutableResult {
    $ticket = $this->readableTicket($input);
    $storage = $this->entities()->getStorage('bb_run');
    $query = $storage->getQuery()->accessCheck(TRUE)->condition('ticket_id', $ticket->id())->sort('id', 'DESC');
    [$ids, $next] = $this->page($query, $values);
    $runs = [];
    foreach ($storage->loadMultiple($ids) as $run) {
      assert($run instanceof BbRunInterface);
      if ($run->access('view', $this->currentUser)) {
        $runs[] = $this->row($run);
      }
    }
    return ExecutableResult::success(new TranslatableMarkup('@count runs found.', ['@count' => count($runs)]), [
      'runs' => $runs,
      'next_offset' => $next,
    ]);
  }

  /**
   * The output row of a run.
   *
   * @return array<string, mixed>
   *   The row.
   */
  private function row(BbRunInterface $run): array {
    $started = $run->get('started_at')->value;
    $ticket = $run->getTicket();
    return [
      'uuid' => $run->uuid(),
      'state' => (string) $run->get('state')->value,
      'state_at_start' => $run->get('state_at_start')->value,
      'agent' => $run->get('agent')->value,
      'conductor' => $run->get('conductor_id')->entity?->uuid(),
      'started_at' => $started === NULL ? NULL : (int) $started,
      'closed' => (bool) $run->get('closed')->value,
      'number' => (int) $run->id(),
      'ticket' => (string) $ticket?->getIdentifier(),
      'ticket_title' => (string) $ticket?->getTitle(),
    ];
  }

  /**
   * The restartable runs of the caller's machine with this machine_id.
   *
   * @return array<int|string, \Drupal\bb_core\Entity\BbRunInterface>
   *   The runs keyed by id.
   */
  private function machineRuns(string $host_key): array {
    $storage = $this->entities()->getStorage('bb_machine');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('owner_user_id', $this->currentUser->id())
      ->condition('host_key', $host_key)
      ->range(0, 1)
      ->execute();
    $machine = $ids ? $storage->load(reset($ids)) : NULL;
    return $machine instanceof BbMachineInterface ? TicketInterventions::restartCoveredRuns($machine) : [];
  }

  /**
   * The restartable runs of this conductor, when it is on the caller's machine.
   *
   * @return array<int|string, \Drupal\bb_core\Entity\BbRunInterface>
   *   The runs keyed by id.
   */
  private function conductorRuns(string $uuid): array {
    $conductors = $this->entities()->getStorage('bb_conductor')->loadByProperties(['uuid' => $uuid]);
    $conductor = reset($conductors);
    return $conductor instanceof BbConductorInterface && TicketInterventions::mayRestartRuns($conductor, $this->currentUser)
      ? TicketInterventions::restartCoveredRuns($conductor)
      : [];
  }

  /**
   * The ticket's restart runs, when the caller may restart it.
   *
   * @return array<int|string, \Drupal\bb_core\Entity\BbRunInterface>
   *   The runs keyed by id.
   */
  private function restartableTicketRuns(string $input): array {
    $ticket = $this->readableTicket($input);
    return TicketInterventions::mayRestartTicket($ticket) ? TicketInterventions::ticketRestartRuns($ticket) : [];
  }

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function checkAccess(array $values, AccountInterface $account, bool $return_as_object = FALSE): bool|AccessResultInterface {
    // Ticket, machine and conductor access, checked in doExecute(), decide.
    return $return_as_object ? AccessResult::allowed() : TRUE;
  }

}
