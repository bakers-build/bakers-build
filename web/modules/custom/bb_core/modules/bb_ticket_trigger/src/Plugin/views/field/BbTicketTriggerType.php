<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Plugin\views\field;

use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\views\Attribute\ViewsField;
use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ResultRow;

/**
 * A trigger's type label or summary, read from its type plugin.
 *
 * A type without a plugin renders "Unavailable trigger type: <id>" in both.
 */
#[ViewsField('bb_ticket_trigger_type')]
final class BbTicketTriggerType extends FieldPluginBase {

  /**
   * {@inheritdoc}
   */
  public function query(): void {
  }

  /**
   * {@inheritdoc}
   */
  public function render(ResultRow $values): string {
    $trigger = $this->getEntity($values);
    if (!$trigger instanceof BbTicketTriggerInterface) {
      return '';
    }
    $plugin = $trigger->getTypePlugin();
    if (($this->definition['part'] ?? 'summary') === 'summary') {
      return $plugin->summary();
    }
    $definition = $plugin->getPluginDefinition();
    return (string) (is_array($definition) ? ($definition['label'] ?? $trigger->getType()) : $trigger->getType());
  }

}
