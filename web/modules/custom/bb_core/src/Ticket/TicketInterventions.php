<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;

/**
 * Who may intervene in a ticket or run, and how an intervention is opened.
 *
 * AI agents drive the workflow; a human on the ticket detail intervenes. The
 * detail offers Freeze, Unfreeze, Cancel ticket and Cancel run, each through a
 * confirmation. Settings carry no transition; Delete is their one action.
 *
 * One home for every intervention rule, so the UI and the tools share it.
 *
 * @SuppressWarnings("PHPMD.TooManyPublicMethods")
 */
final class TicketInterventions {

  /**
   * The one ticket transition the detail page offers.
   */
  public const string CANCEL = 'cancel';

  /**
   * Run states a ticket editor may cancel; mirrors the run workflow's edge.
   */
  private const array ACTIVE_RUN_STATES = ['claimed', 'running'];

  /**
   * The query key that names the run a confirmation is about.
   */
  public const string RUN_PARAMETER = 'run';

  /**
   * The query key that names the freeze target (`1` freeze, `0` unfreeze).
   */
  public const string FREEZE_PARAMETER = 'frozen';

  /**
   * Whether the current account may write the ticket's workflow state.
   */
  public static function maySetState(BbTicketInterface $ticket): bool {
    return !$ticket->get('state')->isEmpty()
      && $ticket->access('update')
      && $ticket->get('state')->access('edit');
  }

  /**
   * Whether the current account may cancel the ticket now.
   */
  public static function mayCancelTicket(BbTicketInterface $ticket): bool {
    return self::maySetState($ticket) && $ticket->getState()->isTransitionAllowed(self::CANCEL);
  }

  /**
   * Whether the current account may write the ticket's frozen flag.
   */
  private static function maySetFrozen(BbTicketInterface $ticket): bool {
    return $ticket->access('update') && $ticket->get('frozen')->access('edit');
  }

  /**
   * Whether the current account may freeze the ticket now.
   */
  public static function mayFreeze(BbTicketInterface $ticket): bool {
    return self::maySetFrozen($ticket) && !$ticket->isFrozen();
  }

  /**
   * Whether the current account may unfreeze the ticket now.
   */
  public static function mayUnfreeze(BbTicketInterface $ticket): bool {
    return self::maySetFrozen($ticket) && $ticket->isFrozen();
  }

  /**
   * Whether the current account may cancel this run of this ticket now.
   */
  public static function mayCancelRun(BbRunInterface $run, BbTicketInterface $ticket): bool {
    return $run->getTicketId() === (int) $ticket->id()
      && $ticket->access('update')
      && in_array($run->getRunState(), self::ACTIVE_RUN_STATES, TRUE)
      && $run->access('view')
      && $run->access('update')
      && $run->get('state')->access('edit')
      && self::runState($run)->isTransitionAllowed(self::CANCEL);
  }

  /**
   * The run with this uuid, if it exists.
   */
  public static function runByUuid(mixed $uuid, EntityTypeManagerInterface $entity_type_manager): ?BbRunInterface {
    if (!is_string($uuid) || $uuid === '') {
      return NULL;
    }
    $runs = $entity_type_manager->getStorage('bb_run')->loadByProperties(['uuid' => $uuid]);
    $run = reset($runs);
    return $run instanceof BbRunInterface ? $run : NULL;
  }

  /**
   * The ticket's claimed or running runs, optionally off one conductor.
   *
   * Loaded without access checks; callers decide who may cancel them.
   *
   * @return array<int|string, \Drupal\bb_core\Entity\BbRunInterface>
   *   The active runs keyed by id.
   */
  public static function activeRuns(BbTicketInterface $ticket, EntityTypeManagerInterface $entity_type_manager, ?int $except_conductor = NULL): array {
    $storage = $entity_type_manager->getStorage('bb_run');
    $query = $storage->getQuery()->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('state', self::ACTIVE_RUN_STATES, 'IN');
    if ($except_conductor !== NULL) {
      $query->condition('conductor_id', $except_conductor, '<>');
    }
    /** @var array<int|string, \Drupal\bb_core\Entity\BbRunInterface> $runs */
    $runs = $storage->loadMultiple($query->execute());
    return $runs;
  }

  /**
   * The claimed or running runs of the machine's conductors, across projects.
   *
   * Loaded without access checks; callers decide who may cancel them.
   *
   * @return array<int|string, \Drupal\bb_core\Entity\BbRunInterface>
   *   The active runs keyed by id.
   */
  public static function activeMachineRuns(BbMachineInterface $machine, EntityTypeManagerInterface $entity_type_manager): array {
    $conductor_ids = $entity_type_manager->getStorage('bb_conductor')->getQuery()->accessCheck(FALSE)
      ->condition('machine', $machine->id())
      ->execute();
    if ($conductor_ids === []) {
      return [];
    }
    $storage = $entity_type_manager->getStorage('bb_run');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('conductor_id', $conductor_ids, 'IN')
      ->condition('state', self::ACTIVE_RUN_STATES, 'IN')
      ->execute();
    /** @var array<int|string, \Drupal\bb_core\Entity\BbRunInterface> $runs */
    $runs = $storage->loadMultiple($ids);
    return $runs;
  }

  /**
   * Cancels the run and appends the note to its error log.
   */
  public static function cancelRun(BbRunInterface $run, string $note): void {
    self::runState($run)->applyTransitionById(self::CANCEL);
    $log = rtrim($run->getErrorLog() ?? '', "\r\n");
    $run->setErrorLog($log === '' ? $note : $log . "\n" . $note);
    $run->save();
  }

  /**
   * The run's workflow state item.
   */
  public static function runState(BbRunInterface $run): StateItemInterface {
    $item = $run->get('state')->first();
    assert($item instanceof StateItemInterface);
    return $item;
  }

  /**
   * The confirmation address for cancelling the ticket or one of its runs.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket the confirmation belongs to.
   * @param \Drupal\bb_core\Entity\BbRunInterface|null $run
   *   The run to cancel, or NULL to cancel the ticket.
   * @param bool $dialog
   *   TRUE for the dialog wrapper format, FALSE for the plain page.
   */
  public static function confirmationUrl(BbTicketInterface $ticket, ?BbRunInterface $run, bool $dialog): Url {
    $query = ['destination' => $ticket->toUrl()->toString()];
    if ($run !== NULL) {
      $query[self::RUN_PARAMETER] = $run->uuid();
    }
    if ($dialog) {
      $query['_wrapper_format'] = 'island_dialog';
    }
    return Url::fromRoute('entity.bb_ticket.action_form', $ticket->toUrl()->getRouteParameters(), ['query' => $query]);
  }

  /**
   * The confirmation address for freezing or unfreezing the ticket.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket the confirmation belongs to.
   * @param bool $frozen
   *   TRUE to freeze, FALSE to unfreeze.
   * @param bool $dialog
   *   TRUE for the dialog wrapper format, FALSE for the plain page.
   */
  public static function freezeUrl(BbTicketInterface $ticket, bool $frozen, bool $dialog): Url {
    $query = [
      'destination' => $ticket->toUrl()->toString(),
      self::FREEZE_PARAMETER => $frozen ? '1' : '0',
    ];
    if ($dialog) {
      $query['_wrapper_format'] = 'island_dialog';
    }
    return Url::fromRoute('entity.bb_ticket.action_form', $ticket->toUrl()->getRouteParameters(), ['query' => $query]);
  }

  /**
   * The htmx attributes that open a confirmation in the shell's overlay.
   *
   * The same contract a create trigger uses: the overlay container is the
   * target and only the `dialog` element of the answer is swapped in.
   *
   * @return array<string, string>
   *   The `hx` keys of an action cell or button.
   */
  public static function dialogHx(BbTicketInterface $ticket, ?BbRunInterface $run): array {
    return [
      'get' => self::confirmationUrl($ticket, $run, TRUE)->toString(),
      'target' => '#bakers-overlay',
      'select' => 'dialog',
      'swap' => 'innerHTML',
    ];
  }

}
