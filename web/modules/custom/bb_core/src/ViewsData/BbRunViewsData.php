<?php

declare(strict_types=1);

namespace Drupal\bb_core\ViewsData;

use Drupal\views\EntityViewsData;

/**
 * Views data for bb_run.
 *
 * A handler rather than a hook — see BbTicketViewsData for why. One addition
 * beyond core, and it exists because core's EntityViewsData cannot make it:
 *
 * - **Select filters on `state` and `conductor_id`.** `state` is a
 *   state_machine BASE field, and state_machine's own views data upgrades only
 *   configurable fields; `conductor_id` gets a numeric filter by default. Both
 *   handlers resolve their field through the field API, so each needs
 *   field_name + entity_type.
 */
final class BbRunViewsData extends EntityViewsData {

  /**
   * {@inheritdoc}
   */
  public function getViewsData(): array {
    $data = parent::getViewsData();

    // `error_log_bytes` is a plain integer, auto-exposed; no alter needed.
    if (isset($data['bb_run']['state']['filter'])) {
      $data['bb_run']['state']['filter']['id'] = 'state_machine_state';
      $data['bb_run']['state']['filter']['field_name'] = 'state';
      $data['bb_run']['state']['filter']['entity_type'] = 'bb_run';
    }
    if (isset($data['bb_run']['conductor_id']['filter'])) {
      $data['bb_run']['conductor_id']['filter']['id'] = 'entity_reference';
      $data['bb_run']['conductor_id']['filter']['field_name'] = 'conductor_id';
      $data['bb_run']['conductor_id']['filter']['entity_type'] = 'bb_run';
    }

    return $data;
  }

}
