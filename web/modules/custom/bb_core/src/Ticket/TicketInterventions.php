<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\Component\Utility\Html;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Claim\TicketStallReason;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;

/**
 * Who may intervene in a ticket or run, and how an intervention is opened.
 *
 * AI agents drive the workflow; a human on the ticket detail intervenes. The
 * detail offers Restart (cancel a parked ticket's newest failed run), Freeze,
 * Unfreeze, Cancel ticket and Cancel run, each through a confirmation.
 * Settings carry no transition; Delete is their one action.
 *
 * One home for every intervention rule, so the UI and the tools share it.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 * @SuppressWarnings("PHPMD.TooManyPublicMethods")
 */
final class TicketInterventions {

  /**
   * The one ticket transition the detail page offers.
   */
  public const string CANCEL = 'cancel';

  /**
   * The run transition that cancels the failed run of a parked ticket.
   */
  private const string CANCEL_FAILED = 'cancel_failed';

  /**
   * Run states a ticket editor may cancel; mirrors the run workflow's edge.
   */
  private const array ACTIVE_RUN_STATES = ['claimed', 'running'];

  /**
   * The query key that names the run a confirmation is about.
   */
  public const string RUN_PARAMETER = 'run';

  /**
   * The query key that names the action a failed run's confirmation is for.
   */
  public const string RUN_ACTION_PARAMETER = 'run_action';

  /**
   * The run action that lifts the failed-run circuit breaker.
   */
  public const string RETRY = 'retry';

  /**
   * The run action that moves the ticket to another conductor and retries.
   */
  public const string REDISPATCH = 'redispatch';

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
      && (in_array($run->getRunState(), self::ACTIVE_RUN_STATES, TRUE) || self::parkedRun($ticket)?->id() === $run->id())
      && $run->access('view')
      && $run->access('update')
      && $run->get('state')->access('edit')
      && self::runState($run)->isTransitionAllowed(self::cancelTransition($run));
  }

  /**
   * Whether a run's row and page offer Cancel run: a claimed or running run.
   *
   * A parked ticket's failed run is restarted from the Properties footer.
   */
  public static function mayCancelActiveRun(BbRunInterface $run, BbTicketInterface $ticket): bool {
    return in_array($run->getRunState(), self::ACTIVE_RUN_STATES, TRUE) && self::mayCancelRun($run, $ticket);
  }

  /**
   * The newest failed run of a ticket the failed-run breaker parks, if any.
   *
   * Cancelling it restarts the ticket: a non-failed run among the newest
   * three frees the next claim. Loaded without access checks.
   */
  public static function parkedRun(BbTicketInterface $ticket): ?BbRunInterface {
    if (!\Drupal::service('bb_core.failed_run_circuit_breaker')->isTripped($ticket)) {
      return NULL;
    }
    $storage = \Drupal::entityTypeManager()->getStorage('bb_run');
    // The breaker's order, so this is the run it counts as newest.
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->sort('changed', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, 1)
      ->execute();
    $run = $ids ? $storage->load(reset($ids)) : NULL;
    return $run instanceof BbRunInterface ? $run : NULL;
  }

  /**
   * The transition that cancels this run: `cancel_failed` for a failed run.
   */
  public static function cancelTransition(BbRunInterface $run): string {
    return $run->getRunState() === 'failed' ? self::CANCEL_FAILED : self::CANCEL;
  }

  /**
   * Whether the current account may retry this failed run of this ticket now.
   *
   * Offered on the ticket's newest run while a conductor can claim again: a
   * frozen, blocked, closed or unassigned ticket would not change.
   */
  public static function mayRetryRun(BbRunInterface $run, BbTicketInterface $ticket): bool {
    return $run->getTicketId() === (int) $ticket->id()
      && $run->getRunState() === 'failed'
      && $ticket->access('update')
      && $run->access('view')
      && $ticket->getConductor() !== NULL
      && !$ticket->isFrozen()
      && !$ticket->isClosed()
      && !$ticket->hasOpenBlockers()
      && self::isNewestRun($run);
  }

  /**
   * Whether the current account may re-dispatch this failed run's ticket now.
   */
  public static function mayRedispatchRun(BbRunInterface $run, BbTicketInterface $ticket): bool {
    return self::mayRetryRun($run, $ticket)
      && $ticket->get('conductor_id')->access('edit')
      && self::redispatchTargets($ticket) !== [];
  }

  /**
   * The conductors the ticket may move to, other than its own, by label.
   *
   * The ticket field's own picker: active conductors of the project whose
   * owner may take the work.
   *
   * @return array<int, string>
   *   Conductor labels keyed by id.
   */
  public static function redispatchTargets(BbTicketInterface $ticket): array {
    $handler = \Drupal::service('plugin.manager.entity_reference_selection')
      ->getSelectionHandler($ticket->get('conductor_id')->getFieldDefinition(), $ticket);
    $targets = [];
    foreach ($handler->getReferenceableEntities() as $labels) {
      foreach ($labels as $id => $label) {
        $targets[(int) $id] = Html::decodeEntities((string) $label);
      }
    }
    unset($targets[(int) $ticket->get('conductor_id')->target_id]);
    return $targets;
  }

  /**
   * The ticket's stall reason a failed run shows in place of Retry, or empty.
   *
   * Only the ticket's newest failed run speaks for the ticket; an older one,
   * or one the reader may retry, shows none.
   */
  public static function retryStall(BbRunInterface $run, BbTicketInterface $ticket): string {
    if ($run->getRunState() !== 'failed' || !self::isNewestRun($run) || self::mayRetryRun($run, $ticket)) {
      return '';
    }
    return (string) $ticket->get('stall_reason')->value;
  }

  /**
   * Cacheability of what a run says and offers on its row and its page.
   *
   * Retry, Re-dispatch and the stall follow the ticket, its newer runs, its
   * blockers and the project's conductors; a claim's words change in time.
   */
  public static function runCacheability(BbRunInterface $run): CacheableMetadata {
    $ticket = $run->getTicket();
    $cache = $ticket instanceof BbTicketInterface
      ? TicketStallReason::cacheability($ticket)->addCacheTags(['bb_conductor_list'])
      : new CacheableMetadata();
    if ($run->getRunState() === 'claimed') {
      // "The claim lapses in …" turns into "The claim lapsed … ago".
      $cache->mergeCacheMaxAge(60);
    }
    return $cache;
  }

  /**
   * Whether no run of the ticket is newer than this one.
   *
   * Newer in the ticket's Run history order (`RunsItemList`), so the run that
   * offers Retry is the top row.
   */
  private static function isNewestRun(BbRunInterface $run): bool {
    $newest = \Drupal::entityTypeManager()->getStorage('bb_run')->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $run->getTicketId())
      ->sort('created', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, 1)
      ->execute();
    return (int) reset($newest) === (int) $run->id();
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
    self::runState($run)->applyTransitionById(self::cancelTransition($run));
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
    return self::overlayHx(self::confirmationUrl($ticket, $run, TRUE));
  }

  /**
   * The confirmation address for retrying or re-dispatching a failed run.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket the confirmation belongs to.
   * @param \Drupal\bb_core\Entity\BbRunInterface $run
   *   The failed run.
   * @param string $action
   *   {@see self::RETRY} or {@see self::REDISPATCH}.
   * @param bool $dialog
   *   TRUE for the dialog wrapper format, FALSE for the plain page.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  public static function runActionUrl(BbTicketInterface $ticket, BbRunInterface $run, string $action, bool $dialog): Url {
    $url = self::confirmationUrl($ticket, $run, $dialog);
    $url->setOption('query', $url->getOption('query') + [self::RUN_ACTION_PARAMETER => $action]);
    return $url;
  }

  /**
   * The htmx attributes that open a run action's confirmation in the overlay.
   *
   * @return array<string, string>
   *   The `hx` keys of an action cell or button.
   */
  public static function runActionHx(BbTicketInterface $ticket, BbRunInterface $run, string $action): array {
    return self::overlayHx(self::runActionUrl($ticket, $run, $action, TRUE));
  }

  /**
   * The htmx attributes that load an address into the overlay.
   *
   * @return array<string, string>
   *   The `hx` keys.
   */
  private static function overlayHx(Url $url): array {
    return [
      'get' => $url->toString(),
      'target' => '#bakers-overlay',
      'select' => 'dialog',
      'swap' => 'innerHTML',
    ];
  }

}
