<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * Machine current_load, including stored zero.
 *
 * UI Patterns treats `#markup => '0'` as an empty slot (`empty('0')` is TRUE)
 * and drops it, so a field formatter never reaches the zone. An `html_tag`
 * keeps the digit.
 */
#[Source(
  id: 'bb_machine_current_load',
  label: new TranslatableMarkup('[bakers.build] Machine current load'),
  description: new TranslatableMarkup('The machine current load, including zero.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_machine', label: new TranslatableMarkup('Machine'), required: TRUE),
  ],
)]
final class MachineCurrentLoadSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $machine = $this->machine();
    if ($machine === NULL) {
      return [];
    }
    return [
      '#type' => 'html_tag',
      '#tag' => 'span',
      '#value' => (string) $machine->getCurrentLoad(),
    ];
  }

  /**
   * Returns the machine context, if present.
   */
  private function machine(): ?BbMachineInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbMachineInterface ? $entity : NULL;
  }

}
