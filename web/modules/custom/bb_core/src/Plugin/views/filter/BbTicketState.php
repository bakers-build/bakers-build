<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\filter;

use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\state_machine\Plugin\views\filter\State;
use Drupal\state_machine\WorkflowManagerInterface;
use Drupal\views\Attribute\ViewsFilter;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * State filter for entities whose workflow is resolved per row.
 *
 * The stock `state_machine_state` filter enumerates the available states by
 * instantiating a bare entity per bundle and reading the workflow off its state
 * field. That works for bb_run (fixed `workflow` setting) but blows up on
 * bb_ticket: its state field resolves the workflow from the sibling
 * `workflow` field via a `workflow_callback`, so a value-less bare entity has
 * no state item and no workflow — `State::getWorkflows()` dereferences NULL.
 *
 * This filter instead lists every workflow in a fixed group (the `bb_ticket`
 * group holds bb_work) and merges their
 * states, so the exposed select offers the full union of ticket states
 * without touching an entity. The group id comes from the views data filter
 * definition (`workflow_group`).
 */
#[ViewsFilter('bb_ticket_state')]
final class BbTicketState extends State {

  /**
   * The workflow plugin manager.
   */
  protected WorkflowManagerInterface $workflowManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('entity_field.manager'),
    );
    $instance->workflowManager = $container->get('plugin.manager.workflow');
    return $instance;
  }

  /**
   * {@inheritdoc}
   *
   * @return \Drupal\state_machine\Plugin\Workflow\WorkflowInterface[]
   *   The workflows in the configured group, keyed by plugin id.
   */
  protected function getWorkflows(EntityTypeInterface $entity_type, $field_name) {
    $group = (string) ($this->definition['workflow_group'] ?? '');
    $workflows = [];
    foreach ($this->workflowManager->getDefinitions() as $id => $definition) {
      if (($definition['group'] ?? '') === $group) {
        /** @var \Drupal\state_machine\Plugin\Workflow\WorkflowInterface $workflow */
        $workflow = $this->workflowManager->createInstance($id);
        $workflows[$id] = $workflow;
      }
    }
    return $workflows;
  }

}
