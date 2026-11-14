<?php

declare(strict_types=1);

namespace Drupal\bb_board;

use Drupal\bb_board\Plugin\views\display\BbBoardColumn;
use Drupal\bb_core\Derive\TicketRunDeriver;
use Drupal\bb_core\Deployment\DeploymentLookup;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Link\LinkKind;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\bb_core\Reference\ReferenceCounter;
use Drupal\bb_core\Time\BbDate;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;

/**
 * Maps ticket entities to board-card props.
 *
 * Column placement is each column display's filters on general index
 * fields. Card status and lease come from {@see TicketRunDeriver}; the
 * assignee mark is the house person mark ({@see PersonIdentityTrait}).
 */
final class ProjectBoard {

  use PersonIdentityTrait;

  public function __construct(
    private readonly TicketRunDeriver $deriver,
    private readonly BbDate $date,
    private readonly ReferenceCounter $referenceCounter,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly DeploymentLookup $deploymentLookup,
  ) {}

  /**
   * Board-card records for one column's tickets.
   *
   * @param array<int|string, \Drupal\bb_core\Entity\BbTicketInterface> $tickets
   *   Tickets already limited to this column. Empty is a legal column.
   * @param string $display
   *   The Views display id. Running status is painted only on the Working
   *   column and its Details columns.
   *
   * @return list<array<string, mixed>>
   *   Props for `bb_theme:board-card`.
   */
  public function cards(array $tickets, string $display = ''): array {
    $tickets = array_filter($tickets, static fn ($ticket): bool => $ticket instanceof BbTicketInterface);
    $ids = array_values(array_map(static fn (BbTicketInterface $ticket): int => (int) $ticket->id(), $tickets));
    $batch = [
      'runs' => $this->referenceCounter->count('bb_run', 'ticket_id', $ids),
      'states' => $this->deriver->latestRunStates($ids),
      'blockers' => $this->blockerIdentifiers($tickets),
      'deployments' => $this->deploymentLookup->deployedEnvironmentsMultiple(array_values($tickets)),
    ];
    $cards = [];
    foreach ($tickets as $ticket) {
      $cards[] = $this->card($ticket, $ticket->getState()->getId(), $display, $batch);
    }
    return $cards;
  }

  /**
   * Identifiers of each ticket's open blockers, and whether any is unseen.
   *
   * One load and one access query for every blocker of the column. Open is
   * {@see BbTicketInterface::isBlocking()}.
   *
   * @param array<int|string, \Drupal\bb_core\Entity\BbTicketInterface> $tickets
   *   The column's tickets.
   *
   * @return array<int, array{visible: list<string>, hidden: bool}>
   *   Per ticket id.
   */
  private function blockerIdentifiers(array $tickets): array {
    $blocker_ids = [];
    foreach ($tickets as $ticket) {
      $blocker_ids += array_flip($ticket->getBlockedByIds());
    }
    if ($blocker_ids === []) {
      return [];
    }
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $open = [];
    foreach ($storage->loadMultiple(array_keys($blocker_ids)) as $id => $blocker) {
      if ($blocker instanceof BbTicketInterface && $blocker->isBlocking()) {
        $open[$id] = $blocker->getIdentifier();
      }
    }
    // View access of a ticket is the read scope, which a query applies.
    $viewable = $storage->getQuery()->accessCheck(TRUE)->condition('id', array_keys($blocker_ids), 'IN')->execute();
    $result = [];
    foreach ($tickets as $ticket) {
      $blocking = array_intersect_key(array_flip($ticket->getBlockedByIds()), $open);
      $visible = array_map(static fn (int|string $id): string => $open[$id], array_keys(array_intersect_key($blocking, $viewable)));
      // Hidden means blocked by something, but nothing the viewer may name.
      $result[(int) $ticket->id()] = ['visible' => $visible, 'hidden' => $blocking !== [] && $visible === []];
    }
    return $result;
  }

  /**
   * One board-card record.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param string $state
   *   The ticket's exact workflow state.
   * @param string $display
   *   The Views display id. Running status is painted only on the Working
   *   column and its Details columns.
   * @param array{runs: array<int|string, int>, states: array<int, string>, blockers: array<int, array{visible: list<string>, hidden: bool}>, deployments: array<int, list<string>>} $batch
   *   Run counts, newest run states and blockers of the whole column.
   *
   * @return array<string, mixed>
   *   Props for `bb_theme:board-card`.
   */
  private function card(BbTicketInterface $ticket, string $state, string $display, array $batch): array {
    $id = (int) $ticket->id();
    $assignee = $this->assignee($ticket);
    $priority = $ticket->getPriority();
    $running = isset(BbBoardColumn::DETAILS[$display]) && $this->deriver->derivedStatus($ticket) === 'running';
    try {
      $url = $ticket->toUrl('canonical')->toString();
    }
    catch (\Exception) {
      $url = '';
    }
    $card = [
      'identifier' => $ticket->getIdentifier(),
      'title' => $ticket->getTitle(),
      'state' => $state,
      'url' => $url,
      'status' => $running ? 'running' : 'idle',
      'blocked_by' => $batch['blockers'][$id]['visible'] ?? [],
      'blocked_hidden' => $batch['blockers'][$id]['hidden'] ?? FALSE,
      'assignee_name' => $assignee['name'],
      'assignee_initials' => $assignee['initials'],
      'assignee_color' => $assignee['color'],
      'type' => $ticket->getWorkflow(),
    ];
    $lease = $this->deriver->claimMachine($ticket);
    if ($lease !== '') {
      $card['lease'] = $lease;
    }
    // No runs, no line: the theme draws "N runs - last <state>" only when set.
    // The access-checked count gates the unchecked newest-run state on purpose.
    if (($batch['runs'][$id] ?? 0) > 0 && isset($batch['states'][$id])) {
      $card['run_count'] = $batch['runs'][$id];
      $card['last_run_state'] = $batch['states'][$id];
    }
    if (in_array($priority, [1, 2, 3], TRUE)) {
      $card['priority'] = 'p' . $priority;
    }
    if (($batch['deployments'][$id] ?? []) !== []) {
      $card['deployed_to'] = $batch['deployments'][$id];
    }
    return $card + $this->doneFacts($ticket);
  }

  /**
   * When a closed ticket was done, relatively, and its merge request.
   *
   * Absent rather than empty on open tickets: the theme draws a done footer
   * only where there is something done to say.
   *
   * @return array{done_label?: string, done_datetime?: string, done_title?: string, mr_url?: string, mr_label?: string}
   *   The facts that apply.
   */
  private function doneFacts(BbTicketInterface $ticket): array {
    if (!$ticket->isClosed()) {
      return [];
    }
    $facts = [];
    $closed = $ticket->get('closed_date')->value;
    if ($closed !== NULL && $closed !== '') {
      $time = $this->date->cell((int) $closed);
      $facts['done_label'] = $time['label'];
      $facts['done_datetime'] = $time['datetime'];
      $facts['done_title'] = $time['title'];
    }
    foreach ($ticket->get('links')->getValue() as $link) {
      $uri = (string) ($link['uri'] ?? '');
      $kind = $link['options']['bakers']['kind'] ?? LinkKind::fromUri($uri);
      if ($kind === LinkKind::MR) {
        $facts['mr_url'] = $uri;
        $facts['mr_label'] = preg_match('#/merge_requests/(\d+)#', $uri, $match) === 1 ? 'MR !' . $match[1] : 'MR';
        break;
      }
    }
    return $facts;
  }

  /**
   * The assignee's mark, drawn as every person mark in the UI draws it.
   *
   * The filter bar's avatars use the same initials and colour, so one person
   * has one mark on the Board. Without an assignee the card shows none.
   *
   * @return array{name: string, initials: string, color: string}
   *   Display name, initials and `person` colour key.
   */
  private function assignee(BbTicketInterface $ticket): array {
    $account = $ticket->get('assignee_user_id')->entity;
    if (!$account instanceof AccountInterface) {
      return ['name' => '', 'initials' => '', 'color' => 'running'];
    }
    $name = (string) $account->getDisplayName();
    return [
      'name' => $name,
      'initials' => $this->personInitials($name),
      'color' => $this->personColor((int) $account->id()),
    ];
  }

}
