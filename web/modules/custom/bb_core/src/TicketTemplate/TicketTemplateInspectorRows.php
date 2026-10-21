<?php

declare(strict_types=1);

namespace Drupal\bb_core\TicketTemplate;

use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\bb_core\Entity\BbTicketTemplateInterface;
use Drupal\bb_core\Inspector\InspectorRows;
use Drupal\bb_core\Workflow\TypeWorkflows;

/**
 * Formats read-only ticket template properties for the detail inspector.
 */
final class TicketTemplateInspectorRows extends InspectorRows {

  /**
   * Inspector fields in display order, keyed by field name.
   */
  public const array FIELDS = [
    'title_pattern' => 'Title',
    'workflow' => 'Workflow',
    'target_state' => 'Target state',
    'labels' => 'Labels',
    'conductor_id' => 'Conductor',
    'enabled' => 'Enabled',
    'owner_user_id' => 'Created by',
  ];

  /**
   * Builds the rail's `items` array.
   *
   * @return array<string, array<string, mixed>>
   *   List items keyed by field machine name.
   */
  public function build(BbTicketTemplateInterface $template): array {
    return $this->buildRows($template, self::FIELDS);
  }

  /**
   * {@inheritdoc}
   */
  protected function fieldRow(FieldableEntityInterface $entity, string $field, string $label): array {
    assert($entity instanceof BbTicketTemplateInterface);
    $workflow = $entity->getWorkflow();
    $targets = TypeWorkflows::templateTargetStateOptions($workflow);
    return match ($field) {
      'title_pattern' => $this->row($label, $this->mono($entity->getTitlePattern())),
      'workflow' => $this->row($label, $this->text(TypeWorkflows::ticketWorkflowOptions()[$workflow] ?? $workflow)),
      // Empty keeps the workflow's initial state, the first target.
      'target_state' => $this->row($label, $this->text($targets[$entity->getTargetState()] ?? (string) reset($targets))),
      'labels' => $this->labelsRow($entity, $label),
      'enabled' => $this->row($label, $this->text($entity->isEnabled() ? 'Yes' : 'No')),
      default => $this->row($label, $this->text($this->labelsOf($entity, $field))),
    };
  }

  /**
   * The labels as badges, one cell per label the viewer may be told.
   *
   * @return array<string, mixed>
   *   The `list` item.
   */
  private function labelsRow(BbTicketTemplateInterface $template, string $label): array {
    $chips = [];
    foreach ($template->get('labels')->referencedEntities() as $term) {
      if ($term->access('view label')) {
        $chips[] = $this->badge((string) $term->label());
      }
    }
    return $this->chipsRow($label, $chips);
  }

}
