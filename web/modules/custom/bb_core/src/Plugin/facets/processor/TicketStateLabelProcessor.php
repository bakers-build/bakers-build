<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\facets\processor;

use Drupal\Core\Cache\UnchangingCacheableDependencyTrait;
use Drupal\facets\FacetInterface;
use Drupal\facets\Processor\BuildProcessorInterface;
use Drupal\facets\Processor\ProcessorPluginBase;
use Drupal\bb_core\Workflow\TypeWorkflows;

/**
 * Names a ticket state by the label its workflow declares.
 *
 * The facets `list_item` processor cannot name a `state_machine` value.
 * Reads
 * TypeWorkflows::ticketStateOptions(), the same source as the
 * `bb_state_label` formatter, unioned across ticket workflows because a
 * facet value has no ticket. A retired state keeps its raw value, so its rows
 * stay reachable.
 *
 * @FacetsProcessor(
 *   id = "bb_ticket_state_label",
 *   label = @Translation("bakers.build ticket state label"),
 *   description = @Translation("Displays a ticket state by the label its workflow declares, as bb_state_label does."),
 *   stages = {
 *     "build" = 5
 *   }
 * )
 */
final class TicketStateLabelProcessor extends ProcessorPluginBase implements BuildProcessorInterface {

  use UnchangingCacheableDependencyTrait;

  /**
   * {@inheritdoc}
   *
   * @param \Drupal\facets\FacetInterface $facet
   *   The facet being built.
   * @param array<int, \Drupal\facets\Result\ResultInterface> $results
   *   The results to name.
   *
   * @return array<int, \Drupal\facets\Result\ResultInterface>
   *   The same results, named.
   */
  public function build(FacetInterface $facet, array $results): array {
    $labels = TypeWorkflows::ticketStateOptions();
    foreach ($results as $result) {
      $label = $labels[(string) $result->getRawValue()] ?? NULL;
      if ($label !== NULL) {
        $result->setDisplayValue($label);
      }
    }
    return $results;
  }

}
