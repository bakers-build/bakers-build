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
 * The summary links to the trigger's page: it is the row's primary cell.
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
   *
   * @return array<string, mixed>|string
   *   The summary as a link to the trigger, or the type label.
   */
  public function render(ResultRow $values): array|string {
    $trigger = $this->getEntity($values);
    if (!$trigger instanceof BbTicketTriggerInterface) {
      return '';
    }
    $plugin = $trigger->getTypePlugin();
    if (($this->definition['part'] ?? 'summary') === 'summary') {
      return ['#type' => 'link', '#title' => $plugin->summary(), '#url' => $trigger->toUrl()];
    }
    $definition = $plugin->getPluginDefinition();
    return (string) (is_array($definition) ? ($definition['label'] ?? $trigger->getType()) : $trigger->getType());
  }

}
