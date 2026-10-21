<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\views\filter;

use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\search_api\Plugin\views\SearchApiHandlerTrait;
use Drupal\views\Attribute\ViewsFilter;
use Drupal\views\Plugin\views\filter\FilterPluginBase;

/**
 * Narrows a Search API view of tickets to the rows still being worked on.
 *
 * The terminal states come from `TypeWorkflows::terminalTicketStates()`
 * rather than a `NOT IN` typed into the view, and terminality is per workflow,
 * so the condition is one group per workflow:
 *
 *   AND over workflows of ( workflow <> W  OR  state NOT IN terminal(W) )
 *
 * A row with an unknown workflow is kept. No operator and not exposable: the
 * narrowing belongs to the display, and an exposed filter renders as a chip.
 */
#[ViewsFilter('bb_non_terminal_ticket_state')]
final class BbNonTerminalTicketState extends FilterPluginBase {

  use SearchApiHandlerTrait;

  /**
   * {@inheritdoc}
   *
   * The name is core's — `FilterPluginBase` declares it in snake_case and reads
   * it in `buildOptionsForm()` to decide whether to offer an operator select.
   * Renaming it would leave the parent's read pointing at nothing.
   *
   * @var bool
   */
  // phpcs:ignore Drupal.NamingConventions.ValidVariableName.LowerCamelName
  public $no_operator = TRUE;

  /**
   * {@inheritdoc}
   */
  public function canExpose(): bool {
    return FALSE;
  }

  /**
   * {@inheritdoc}
   */
  public function adminSummary(): string {
    return (string) $this->t('is not terminal in its own workflow');
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
    $query = $this->getQuery();
    if ($query === NULL) {
      return;
    }
    $terminal = TypeWorkflows::terminalTicketStates();
    if ($terminal === []) {
      // Load-bearing guard rather than defensive noise, and the same one
      // `bb_core_post_update_close_terminal_tickets()` states: a condition
      // group with no children narrows nothing, so an empty map has to mean
      // "keep every row" and not "an empty condition". Unreachable while the
      // workflows are installed.
      return;
    }
    // The field the workflow is stored in, so the definition rather than a
    // constant: this filter is registered against an index field and the
    // sibling field's name belongs with that registration.
    $workflow_field = (string) ($this->definition['bb_workflow_field'] ?? 'workflow');

    $outer = $query->createConditionGroup('AND');
    foreach ($terminal as $workflow_id => $states) {
      $group = $query->createConditionGroup('OR');
      $group->addCondition($workflow_field, $workflow_id, '<>');
      $group->addCondition($this->realField, array_values($states), 'NOT IN');
      $outer->addConditionGroup($group);
    }
    $query->addConditionGroup($outer, $this->options['group']);
  }

}
