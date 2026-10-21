<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger;

use Drupal\Core\Entity\Sql\TableMappingInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\EntityViewsData;
use Drupal\views\EntityViewsData as CoreEntityViewsData;

/**
 * Adds the computed list cells of a trigger: type, summary, local next run.
 *
 * Extends the Entity module's handler so the target bundles' reference
 * fields get Views data.
 */
final class BbTicketTriggerViewsData extends EntityViewsData {

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The views data.
   */
  public function getViewsData(): array {
    $data = parent::getViewsData();
    $data['bb_ticket_trigger']['type_label'] = [
      'title' => new TranslatableMarkup('Trigger type'),
      'help' => new TranslatableMarkup('The type label, or "Unavailable trigger type: <id>".'),
      'field' => ['id' => 'bb_ticket_trigger_type', 'part' => 'label'],
    ];
    $data['bb_ticket_trigger']['summary'] = [
      'title' => new TranslatableMarkup('Trigger summary'),
      'help' => new TranslatableMarkup('One line describing the configuration.'),
      'field' => ['id' => 'bb_ticket_trigger_type', 'part' => 'summary'],
    ];
    $data['bb_ticket_trigger']['next_run_local'] = [
      'title' => new TranslatableMarkup('Next run (local)'),
      'help' => new TranslatableMarkup("The next due occurrence in the trigger's own time zone."),
      'field' => ['id' => 'bb_ticket_trigger_next_run'],
    ];
    $data['bb_ticket_trigger']['actions'] = [
      'title' => new TranslatableMarkup('Trigger actions'),
      'help' => new TranslatableMarkup('Edit, Pause/Resume and Delete as an action menu.'),
      'field' => ['id' => 'bb_ticket_trigger_actions'],
    ];
    return $data;
  }

  /**
   * {@inheritdoc}
   *
   * The Plugin module's Views alter expects core's column titles for the
   * `trigger_type` plugin field; the Entity module's mapping changes them.
   *
   * @param string $table
   *   The table name.
   * @param string $field_name
   *   The field name.
   * @param \Drupal\Core\Field\FieldDefinitionInterface $field_definition
   *   The field definition.
   * @param \Drupal\Core\Entity\Sql\TableMappingInterface $table_mapping
   *   The table mapping.
   * @param array<mixed> $table_data
   *   The table data.
   *
   * @param-out array<mixed> $table_data
   */
  protected function mapFieldDefinition($table, $field_name, FieldDefinitionInterface $field_definition, TableMappingInterface $table_mapping, &$table_data): void {
    if (str_starts_with($field_definition->getType(), 'plugin:')) {
      CoreEntityViewsData::mapFieldDefinition($table, $field_name, $field_definition, $table_mapping, $table_data);
      return;
    }
    parent::mapFieldDefinition($table, $field_name, $field_definition, $table_mapping, $table_data);
  }

}
