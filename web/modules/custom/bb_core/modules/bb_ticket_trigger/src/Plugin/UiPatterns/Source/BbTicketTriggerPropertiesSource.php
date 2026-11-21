<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * The trigger page's properties: its condition and whether it runs.
 */
#[Source(
  id: 'bb_ticket_trigger_properties',
  label: new TranslatableMarkup('[bakers.build] Ticket trigger properties'),
  description: new TranslatableMarkup('The condition and state of a ticket trigger.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_ticket_trigger', label: new TranslatableMarkup('Ticket trigger'), required: TRUE),
  ],
)]
final class BbTicketTriggerPropertiesSource extends SourcePluginBase {

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $trigger = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$trigger instanceof BbTicketTriggerInterface) {
      return [];
    }
    $rows = [
      (string) $this->t('Condition') => (string) $trigger->label(),
      (string) $this->t('State') => (string) ($trigger->isEnabled() ? $this->t('Enabled') : $this->t('Paused')),
    ];
    $items = [];
    foreach ($rows as $label => $value) {
      $items[] = [
        'cells' => [
          'label' => ['kind' => 'text', 'value' => $label, 'emphasis' => 'faint'],
          'value' => ['kind' => 'text', 'value' => $value],
        ],
      ];
    }
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:list',
      '#props' => ['layout' => 'plain', 'items' => $items],
    ];
    CacheableMetadata::createFromObject($trigger)->applyTo($build);
    return $build;
  }

}
