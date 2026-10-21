<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * Heartbeat reported_load, including stored zero.
 *
 * UI Patterns treats `#markup => '0'` as an empty slot (`empty('0')` is TRUE)
 * and drops it, so a field formatter never reaches the zone. An `html_tag`
 * keeps the digit.
 */
#[Source(
  id: 'bb_conductor_reported_load',
  label: new TranslatableMarkup('[bakers.build] Conductor reported load'),
  description: new TranslatableMarkup('The conductor heartbeat load, including zero.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_conductor', label: new TranslatableMarkup('Conductor'), required: TRUE),
  ],
)]
final class ConductorReportedLoadSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $conductor = $this->conductor();
    if ($conductor === NULL) {
      return [];
    }
    return [
      '#type' => 'html_tag',
      '#tag' => 'span',
      '#value' => (string) (int) ($conductor->get('reported_load')->value ?? 0),
    ];
  }

  /**
   * Returns the conductor context, if present.
   */
  private function conductor(): ?BbConductorInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbConductorInterface ? $entity : NULL;
  }

}
