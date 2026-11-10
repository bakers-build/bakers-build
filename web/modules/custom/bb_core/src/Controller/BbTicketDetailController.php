<?php

declare(strict_types=1);

namespace Drupal\bb_core\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketInterventions;
use Symfony\Component\HttpFoundation\Request;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbTicketDetailHeaderSource;

/**
 * Supplies the document title for the canonical ticket entity view.
 */
final class BbTicketDetailController extends ControllerBase {

  /**
   * Returns the browser-tab title; the display owns visible composition.
   */
  public function title(BbTicketInterface $bb_ticket): string {
    return BbTicketDetailHeaderSource::headline($bb_ticket);
  }

  /**
   * The title of an intervention confirmation.
   */
  public function interventionTitle(BbTicketInterface $bb_ticket, Request $request): string {
    if ($request->query->has(TicketInterventions::FREEZE_PARAMETER)) {
      $label = $bb_ticket->getIdentifier() !== '' ? $bb_ticket->getIdentifier() : (string) $bb_ticket->label();
      return $request->query->get(TicketInterventions::FREEZE_PARAMETER) === '1'
        ? (string) $this->t('Freeze @ticket?', ['@ticket' => $label])
        : (string) $this->t('Unfreeze @ticket?', ['@ticket' => $label]);
    }
    if ($request->query->has(TicketInterventions::RUN_PARAMETER)) {
      return $this->runTitle($bb_ticket, $request);
    }
    $label = $bb_ticket->getIdentifier() !== '' ? $bb_ticket->getIdentifier() : (string) $bb_ticket->label();
    return (string) $this->t('Cancel @ticket?', ['@ticket' => $label]);
  }

  /**
   * The title of a run's confirmation: Cancel, Retry or Re-dispatch.
   */
  private function runTitle(BbTicketInterface $bb_ticket, Request $request): string {
    $run = TicketInterventions::runByUuid($request->query->get(TicketInterventions::RUN_PARAMETER), $this->entityTypeManager());
    $action = $request->query->get(TicketInterventions::RUN_ACTION_PARAMETER);
    // Name only a run the reader may act on; any other gets no number.
    return match ($action) {
      TicketInterventions::RETRY => $run !== NULL && TicketInterventions::mayRetryRun($run, $bb_ticket)
        ? (string) $this->t('Retry run #@run?', ['@run' => $run->id()])
        : (string) $this->t('Retry run?'),
      TicketInterventions::REDISPATCH => $run !== NULL && TicketInterventions::mayRedispatchRun($run, $bb_ticket)
        ? (string) $this->t('Re-dispatch run #@run?', ['@run' => $run->id()])
        : (string) $this->t('Re-dispatch run?'),
      default => $run !== NULL && $action === NULL && TicketInterventions::mayCancelRun($run, $bb_ticket)
        ? (string) $this->t('Cancel run #@run?', ['@run' => $run->id()])
        : (string) $this->t('Cancel run?'),
    };
  }

}
