<?php

declare(strict_types=1);

namespace Drupal\bb_board\Plugin\facets\processor;

use Drupal\Core\Cache\UnchangingCacheableDependencyTrait;
use Drupal\facets\FacetInterface;
use Drupal\facets\Processor\BuildProcessorInterface;
use Drupal\facets\Processor\ProcessorPluginBase;

/**
 * Names a facet's missing value by the facet's missing label.
 *
 * The exposed-filter facet renders each row's display value, and contrib
 * leaves the missing row's at its raw `!` marker.
 *
 * @FacetsProcessor(
 *   id = "bb_missing_label",
 *   label = @Translation("bakers.build missing label"),
 *   description = @Translation("Displays the missing value by the facet's missing label."),
 *   stages = {
 *     "build" = 10
 *   }
 * )
 */
final class MissingLabelProcessor extends ProcessorPluginBase implements BuildProcessorInterface {

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
   *   The same results, the missing one named.
   */
  public function build(FacetInterface $facet, array $results): array {
    foreach ($results as $result) {
      if ($result->isMissing()) {
        $result->setDisplayValue($facet->getMissingLabel());
      }
    }
    return $results;
  }

}
