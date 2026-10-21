<?php

declare(strict_types=1);

namespace Drupal\bb_core\ViewsData;

use Drupal\views\EntityViewsData;

/**
 * Views data for bb_ticket.
 *
 * A handler rather than a views-data hook: the entity declares its own
 * handlers. What it adds beyond core:
 *
 * - **The reverse relationship to bb_run.** Core generates no reverse
 *   relationship for a BASE field, so `bb_run.ticket_id` gives
 *   bb_ticket → bb_run nothing to join on.
 * - **Filter upgrades.** `EntityViewsData` maps the list_string `workflow` to a
 *   plain string filter, the entity_reference fields to numeric filters, and
 *   the state_machine `state` base field to a plain string filter — none of
 *   which offers a select. state_machine's own views data only upgrades
 *   CONFIGURABLE fields, never base fields, which is why the state filter has
 *   to be attached here at all.
 */
final class BbTicketViewsData extends EntityViewsData {

  /**
   * {@inheritdoc}
   */
  public function getViewsData(): array {
    $data = parent::getViewsData();

    $data['bb_ticket']['active_run'] = [
      'title' => $this->t('Active run'),
      'help' => $this->t('The bb_run row(s) claiming this ticket.'),
      'relationship' => [
        'id' => 'standard',
        'base' => 'bb_run',
        'base field' => 'ticket_id',
        'field' => 'id',
        'label' => $this->t('Active run'),
      ],
    ];

    // All of these handlers resolve their field through the field API, so each
    // needs field_name + entity_type beside the id.
    $reference_filters = ['assignee_user_id', 'conductor_id', 'project_id'];
    foreach ($reference_filters as $field_name) {
      if (isset($data['bb_ticket'][$field_name]['filter'])) {
        $data['bb_ticket'][$field_name]['filter']['id'] = 'entity_reference';
        $data['bb_ticket'][$field_name]['filter']['field_name'] = $field_name;
        $data['bb_ticket'][$field_name]['filter']['entity_type'] = 'bb_ticket';
      }
    }

    if (isset($data['bb_ticket']['workflow']['filter'])) {
      $data['bb_ticket']['workflow']['filter']['id'] = 'list_field';
      $data['bb_ticket']['workflow']['filter']['field_name'] = 'workflow';
      $data['bb_ticket']['workflow']['filter']['entity_type'] = 'bb_ticket';
    }

    if (isset($data['bb_ticket']['state']['filter'])) {
      // Not the stock state_machine_state filter: bb_ticket resolves its
      // workflow per row (workflow_callback), so state enumeration must read
      // the workflow group rather than a value-less bare entity.
      // @see \Drupal\bb_core\Plugin\views\filter\BbTicketState
      $data['bb_ticket']['state']['filter']['id'] = 'bb_ticket_state';
      $data['bb_ticket']['state']['filter']['field_name'] = 'state';
      $data['bb_ticket']['state']['filter']['entity_type'] = 'bb_ticket';
      $data['bb_ticket']['state']['filter']['workflow_group'] = 'bb_ticket';
    }

    return $data;
  }

}
