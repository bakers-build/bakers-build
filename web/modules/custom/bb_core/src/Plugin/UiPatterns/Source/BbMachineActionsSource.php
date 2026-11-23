<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Form\BbRestartRunsForm;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

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
   * The current-session account proxy, injected in `create()`.
   */
  protected AccountProxyInterface $currentUser;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->currentUser = $container->get('current_user');
    return $instance;
  }

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
    if (TicketInterventions::mayRestartRuns($machine, $this->currentUser)) {
      $build['restart'] = BbRestartRunsForm::button($machine);
    }
    CacheableMetadata::createFromObject($machine)->addCacheContexts(['user'])->applyTo($build);
    return $build;
  }

}
