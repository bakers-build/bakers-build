<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Run\RunSummary;
use Drupal\bb_core\Run\TicketRunSummary;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The ticket's runs summary, for the Run history heading row.
 *
 * "No runs yet" without runs for a reader who may view every run. Any other
 * reader who sees no run gets nothing, so the zone stays hidden (BB-414); the
 * empty result still varies by reader.
 */
#[Source(
  id: 'bb_ticket_runs_summary',
  label: new TranslatableMarkup('[bakers.build] Ticket runs summary'),
  description: new TranslatableMarkup('How many runs the ticket has, and the state and time of the newest.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket', label: new TranslatableMarkup('Ticket'), required: TRUE),
  ],
)]
final class BbTicketRunsSummarySource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Computes the summary.
   */
  protected TicketRunSummary $runSummary;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->runSummary = $container->get('bb_core.ticket_run_summary');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $ticket = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$ticket instanceof BbTicketInterface || $ticket->isNew()) {
      return [];
    }
    return $this->runSummary->forTicket($ticket->id())?->build() ?? ['#cache' => RunSummary::CACHE];
  }

}
