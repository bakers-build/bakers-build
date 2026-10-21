<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\facets\processor;

use Drupal\Core\Cache\UnchangingCacheableDependencyTrait;
use Drupal\facets\FacetInterface;
use Drupal\facets\Processor\BuildProcessorInterface;
use Drupal\facets\Processor\ProcessorPluginBase;
use Drupal\bb_core\Workflow\TypeWorkflows;

/**
 * Names a run state by the label its workflow declares.
 *
 * The facets `list_item` processor cannot name a `state_machine` value.
 * Kept separate
 * from TicketStateLabelProcessor so each facet reads its own workflow. A state
 * the workflow no longer declares keeps its raw value, so its rows stay
 * reachable.
 *
 * @FacetsProcessor(
 *   id = "bb_run_state_label",
 *   label = @Translation("bakers.build run state label"),
 *   description = @Translation("Displays a run state by the label its workflow declares."),
 *   stages = {
 *     "build" = 5
 *   }
 * )
 */
final class RunStateLabelProcessor extends ProcessorPluginBase implements BuildProcessorInterface {

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
    $labels = TypeWorkflows::runStateOptions();
    foreach ($results as $result) {
      $label = $labels[(string) $result->getRawValue()] ?? NULL;
      if ($label !== NULL) {
        $result->setDisplayValue($label);
      }
    }
    return $results;
  }

}
