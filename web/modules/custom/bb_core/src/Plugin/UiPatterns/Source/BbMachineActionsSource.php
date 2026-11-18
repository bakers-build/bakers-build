<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Form\BbRestartRunsForm;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * The machine inspector footer: Restart runs, for the machine's owner.
 */
#[Source(
  id: 'bb_machine_actions',
  label: new TranslatableMarkup('[bakers.build] Machine actions'),
  description: new TranslatableMarkup('Restart runs on a machine, behind a confirmation.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_machine', label: new TranslatableMarkup('Machine'), required: TRUE),
  ],
)]
final class BbMachineActionsSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $machine = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$machine instanceof BbMachineInterface) {
      return [];
    }
    $build = [];
    if (TicketInterventions::mayRestartRuns($machine, \Drupal::currentUser())) {
      $build['restart'] = BbRestartRunsForm::button($machine);
    }
    CacheableMetadata::createFromObject($machine)->addCacheContexts(['user'])->applyTo($build);
    return $build;
  }

}
