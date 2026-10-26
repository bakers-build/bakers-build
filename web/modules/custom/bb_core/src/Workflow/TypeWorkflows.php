<?php

declare(strict_types=1);

namespace Drupal\bb_core\Workflow;

/**
 * Reads per-state metadata from the bakers.build ticket workflows.
 *
 * Workflow selection is stored directly on the ticket via the `workflow` field;
 * there is no type→workflow mapping. A state is claimable when its workflow
 * definition marks it `claimable: true`.
 *
 * Static because `allowed_values_function` callbacks and entity code call it
 * without a construction seam; the workflow manager comes from the container.
 */
final class TypeWorkflows {

  /**
   * Workflow group whose states a conductor may register for.
   */
  private const TICKET_GROUP = 'bb_ticket';

  /**
   * The general phases every workflow state falls into.
   *
   * A phase answers ONE question — who is on the hook right now — and it is a
   * fact about the WORK rather than about any screen. It exists because a
   * caller that wants "is this executing" must not have to know that
   * `working` and `running` are two
   * names for it across two workflows.
   *
   * The list is a closed vocabulary on purpose: `phase()` rejects a value
   * outside it, so a typo in `bb_core.workflows.yml` is a failure and not a
   * sixth phase nothing handles.
   *
   * @var array<string>
   */
  public const PHASES = ['prepare', 'running', 'review', 'done', 'cancelled'];

  /**
   * Returns the metadata for a state as defined in the workflow definition.
   *
   * @param string $workflow_id
   *   The workflow plugin ID (e.g. 'bb_work').
   * @param string $state
   *   The workflow state machine name.
   *
   * @return array<string, mixed>
   *   State definition keys (at least 'label'), or an empty array.
   */
  public static function stateMetadata(string $workflow_id, string $state): array {
    $definition = self::workflowDefinition($workflow_id);
    $metadata = $definition['states'][$state] ?? [];
    return is_array($metadata) ? $metadata : [];
  }

  /**
   * Returns TRUE when the given state is claimable in the given workflow.
   *
   * @param string $workflow_id
   *   The workflow plugin ID.
   * @param string $state
   *   The state machine name.
   *
   * @return bool
   *   TRUE when the state defines `claimable: true`.
   */
  public static function isClaimable(string $workflow_id, string $state): bool {
    return (bool) (self::stateMetadata($workflow_id, $state)['claimable'] ?? FALSE);
  }

  /**
   * Returns the general phase of a state in the given workflow.
   *
   * The phase is declared in `bb_core.workflows.yml` beside the state's
   * label. A missing `phase:` is a definition defect, so this throws rather
   * than defaults (TypeWorkflowsTest covers every state). A caller that may
   * hold a drifted state must ask stateMetadata() first, as
   * `BbTicket::getBbPhase()` does.
   *
   * @param string $workflow_id
   *   The workflow plugin ID.
   * @param string $state
   *   The state machine name.
   *
   * @return string
   *   One of self::PHASES.
   *
   * @throws \LogicException
   *   When the state declares no phase, or one outside self::PHASES.
   */
  public static function phase(string $workflow_id, string $state): string {
    $phase = self::stateMetadata($workflow_id, $state)['phase'] ?? NULL;
    if (!is_string($phase) || !in_array($phase, self::PHASES, TRUE)) {
      throw new \LogicException(sprintf(
        'State "%s" of workflow "%s" declares no usable `phase` (got %s). Every state in bb_core.workflows.yml must declare one of: %s.',
        $state,
        $workflow_id,
        var_export($phase, TRUE),
        implode(', ', self::PHASES),
      ));
    }
    return $phase;
  }

  /**
   * Returns TRUE when the given state is terminal in the given workflow.
   *
   * A state is terminal when it is defined but no transition lists it in its
   * `from` set — nothing leaves it (e.g. `done`, `cancelled`). Terminal states
   * are the ones with no follow-on claim, so their run closure cannot ride
   * retireSupersededRuns and must be handled on the edge itself.
   *
   * @param string $workflow_id
   *   The workflow plugin ID.
   * @param string $state
   *   The state machine name.
   *
   * @return bool
   *   TRUE when the state exists and no transition leaves it.
   */
  public static function isTerminal(string $workflow_id, string $state): bool {
    $definition = self::workflowDefinition($workflow_id);
    if (!isset($definition['states'][$state])) {
      return FALSE;
    }
    foreach (($definition['transitions'] ?? []) as $transition) {
      if (is_array($transition) && in_array($state, (array) ($transition['from'] ?? []), TRUE)) {
        return FALSE;
      }
    }
    return TRUE;
  }

  /**
   * Returns each ticket workflow's terminal states, keyed by workflow ID.
   *
   * Terminality is a PER-WORKFLOW property — a state is terminal in a workflow
   * when no transition of that workflow lists it in a `from` set — so a
   * consumer matching stored rows must keep the state bound to its workflow. A
   * flat union of terminal state names would close the `done` rows of a
   * workflow that later gains a transition out of `done`.
   *
   * A workflow with no terminal state produces no key rather than an empty
   * array, so a caller never iterates an empty state list. Only the
   * `bb_ticket` group is walked, so bb_run's terminal states (`done`,
   * `expired`, `failed`) are absent by construction.
   *
   * @return array<string, array<string>>
   *   Workflow plugin ID => that workflow's terminal state machine names.
   */
  public static function terminalTicketStates(): array {
    return self::ticketStatesByTerminality(TRUE);
  }

  /**
   * Returns each ticket workflow's non-terminal states, keyed by workflow ID.
   *
   * The complement of terminalTicketStates(): a state is included when that
   * workflow still lists it in some transition's `from` set. Used to heal
   * closed rows that never reached a terminal state without a SQL NOT over
   * the terminal pairs (Drupal's query Condition has no NOT combinator).
   *
   * @return array<string, array<string>>
   *   Workflow plugin ID => that workflow's non-terminal state machine names.
   */
  public static function nonTerminalTicketStates(): array {
    return self::ticketStatesByTerminality(FALSE);
  }

  /**
   * Collects ticket-workflow states that match or miss terminality.
   *
   * @param bool $terminal
   *   TRUE for terminal states, FALSE for still-leavable ones.
   *
   * @return array<string, array<string>>
   *   Workflow plugin ID => matching state machine names.
   */
  private static function ticketStatesByTerminality(bool $terminal): array {
    $out = [];
    foreach (self::ticketWorkflowIds() as $workflow_id) {
      $states = self::workflowDefinition($workflow_id)['states'] ?? [];
      if (!is_array($states)) {
        continue;
      }
      foreach (array_keys($states) as $state) {
        if (self::isTerminal($workflow_id, (string) $state) === $terminal) {
          $out[$workflow_id][] = (string) $state;
        }
      }
    }
    return $out;
  }

  /**
   * Returns all claimable state options across the ticket workflows.
   *
   * Used as allowed_values_function for the conductor `states` field.
   *
   * @return array<string, string>
   *   State machine name => label pairs, sorted by key.
   */
  public static function stateOptions(): array {
    $options = [];
    foreach (self::ticketWorkflowIds() as $workflow_id) {
      $definition = self::workflowDefinition($workflow_id);
      foreach (($definition['states'] ?? []) as $state => $metadata) {
        if (is_array($metadata) && ($metadata['claimable'] ?? FALSE)) {
          $options[(string) $state] = (string) ($metadata['label'] ?? $state);
        }
      }
    }
    ksort($options);
    return $options;
  }

  /**
   * Returns state => label options across all ticket workflows.
   *
   * The union of every state defined by the ticket-group workflows, used to
   * populate the dashboard state filter select. Unlike stateOptions()
   * this includes non-claimable/terminal states so the list can be filtered to
   * any state a ticket may hold.
   *
   * @return array<string, string>
   *   State machine name => label pairs, in workflow-definition order.
   */
  public static function ticketStateOptions(): array {
    $options = [];
    foreach (self::ticketWorkflowIds() as $workflow_id) {
      $definition = self::workflowDefinition($workflow_id);
      foreach (($definition['states'] ?? []) as $state => $metadata) {
        $label = is_array($metadata) ? (string) ($metadata['label'] ?? $state) : (string) $state;
        $options[(string) $state] = $label;
      }
    }
    return $options;
  }

  /**
   * Returns the states a ticket template of a workflow may target.
   *
   * The initial state plus every non-terminal state one transition away from
   * it: the instantiator applies at most one transition after creation.
   *
   * @param string $workflow_id
   *   The ticket workflow plugin ID.
   *
   * @return array<string, string>
   *   State machine name => label pairs, initial state first; empty for an
   *   unknown workflow.
   */
  public static function templateTargetStateOptions(string $workflow_id): array {
    $definition = self::workflowDefinition($workflow_id);
    $states = $definition['states'] ?? [];
    if (!is_array($states) || $states === []) {
      return [];
    }
    $initial = (string) array_key_first($states);
    $targets = [$initial];
    foreach (($definition['transitions'] ?? []) as $transition) {
      if (is_array($transition) && in_array($initial, (array) ($transition['from'] ?? []), TRUE)) {
        $targets[] = (string) $transition['to'];
      }
    }
    $options = [];
    foreach (array_unique($targets) as $state) {
      if ($state === $initial || !self::isTerminal($workflow_id, $state)) {
        $options[$state] = (string) ($states[$state]['label'] ?? $state);
      }
    }
    return $options;
  }

  /**
   * Returns state => label options for the run workflow.
   *
   * The run workflow is a single definition rather than a group, so unlike
   * ticketStateOptions() there is no union to take. It reads the SAME source
   * every other state reading reads, which is the point: a facet and the badge
   * beside it must not be two vocabularies for one value.
   *
   * @return array<string, string>
   *   State machine name => label pairs, in workflow-definition order.
   */
  public static function runStateOptions(): array {
    $options = [];
    $definition = self::workflowDefinition('bb_run');
    foreach (($definition['states'] ?? []) as $state => $metadata) {
      $label = is_array($metadata) ? (string) ($metadata['label'] ?? $state) : (string) $state;
      $options[(string) $state] = $label;
    }
    return $options;
  }

  /**
   * Returns all workflow IDs belonging to the bb_ticket group.
   *
   * @return string[]
   *   The ticket workflow plugin IDs.
   */
  public static function ticketWorkflowIds(): array {
    $ids = [];
    /** @var \Drupal\Component\Plugin\PluginManagerInterface $manager */
    $manager = \Drupal::service('plugin.manager.workflow');
    foreach ($manager->getDefinitions() as $id => $definition) {
      if (is_array($definition) && ($definition['group'] ?? '') === self::TICKET_GROUP) {
        $ids[] = (string) $id;
      }
    }
    return $ids;
  }

  /**
   * Returns workflow_id => label options for the ticket workflow dropdown.
   *
   * Used as allowed_values_function for the ticket `workflow` field.
   *
   * @return array<string, string>
   *   Workflow plugin ID => label pairs, sorted by key.
   */
  public static function ticketWorkflowOptions(): array {
    $options = [];
    /** @var \Drupal\Component\Plugin\PluginManagerInterface $manager */
    $manager = \Drupal::service('plugin.manager.workflow');
    foreach ($manager->getDefinitions() as $id => $definition) {
      if (is_array($definition) && ($definition['group'] ?? '') === self::TICKET_GROUP) {
        $options[(string) $id] = (string) ($definition['label'] ?? $id);
      }
    }
    ksort($options);
    return $options;
  }

  /**
   * Loads a workflow plugin definition from the workflow plugin manager.
   *
   * @param string $workflow_id
   *   The workflow plugin ID.
   *
   * @return array<string, mixed>
   *   The plugin definition array, or an empty array when undefined.
   */
  private static function workflowDefinition(string $workflow_id): array {
    /** @var \Drupal\Component\Plugin\PluginManagerInterface $manager */
    $manager = \Drupal::service('plugin.manager.workflow');
    $definition = $manager->getDefinition($workflow_id, FALSE);
    return is_array($definition) ? $definition : [];
  }

}
