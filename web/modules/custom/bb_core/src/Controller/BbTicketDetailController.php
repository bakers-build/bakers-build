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
      $run = TicketInterventions::runByUuid($request->query->get(TicketInterventions::RUN_PARAMETER), $this->entityTypeManager());
      // Name only a run the reader may cancel; any other gets no number.
      return $run !== NULL && TicketInterventions::mayCancelRun($run, $bb_ticket)
        ? (string) $this->t('Cancel run #@run?', ['@run' => $run->id()])
        : (string) $this->t('Cancel run?');
    }
    $label = $bb_ticket->getIdentifier() !== '' ? $bb_ticket->getIdentifier() : (string) $bb_ticket->label();
    return (string) $this->t('Cancel @ticket?', ['@ticket' => $label]);
  }

}
