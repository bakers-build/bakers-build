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
    $label = $bb_ticket->getIdentifier() !== '' ? $bb_ticket->getIdentifier() : (string) $bb_ticket->label();
    if ($request->query->has(TicketInterventions::FREEZE_PARAMETER)) {
      return $request->query->get(TicketInterventions::FREEZE_PARAMETER) === '1'
        ? (string) $this->t('Freeze @ticket?', ['@ticket' => $label])
        : (string) $this->t('Unfreeze @ticket?', ['@ticket' => $label]);
    }
    if ($request->query->has(TicketInterventions::RUN_PARAMETER)) {
      return $this->runTitle($bb_ticket, $request, $label);
    }
    return (string) $this->t('Cancel @ticket?', ['@ticket' => $label]);
  }

  /**
   * The title of a Cancel run confirmation, or Restart for a parked run.
   */
  private function runTitle(BbTicketInterface $bb_ticket, Request $request, string $label): string {
    $run = TicketInterventions::runByUuid($request->query->get(TicketInterventions::RUN_PARAMETER), $this->entityTypeManager());
    // Name only a run the reader may cancel; any other gets no number.
    if ($run === NULL || !TicketInterventions::mayCancelRun($run, $bb_ticket)) {
      return (string) $this->t('Cancel run?');
    }
    return $run->getRunState() === 'failed'
      ? (string) $this->t('Restart @ticket?', ['@ticket' => $label])
      : (string) $this->t('Cancel run #@run?', ['@run' => $run->id()]);
  }

}
