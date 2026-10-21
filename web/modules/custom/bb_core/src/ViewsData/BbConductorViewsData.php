<?php

declare(strict_types=1);

namespace Drupal\bb_core\ViewsData;

use Drupal\views\EntityViewsData;

/**
 * Views data for bb_conductor.
 *
 * A handler rather than a hook — see BbTicketViewsData for why.
 *
 * Adds the column-less `utilization` pseudo-field (`current_load` against
 * `max_parallel`, with an idle/partial/full level). Upgrades the list_string
 * `status` base field to a `list_field` filter (core maps only configurable
 * list fields to a select) and `owner_user_id` to an `entity_reference`
 * filter, so views can expose a user autocomplete.
 */
final class BbConductorViewsData extends EntityViewsData {

  /**
   * {@inheritdoc}
   */
  public function getViewsData(): array {
    $data = parent::getViewsData();

    $data['bb_conductor']['utilization'] = [
      'title' => $this->t('Utilization'),
      'help' => $this->t('Current load against capacity ("2/4"), marked idle, partial or full.'),
      'field' => ['id' => 'bb_conductor_utilization'],
    ];

    if (isset($data['bb_conductor']['status']['filter'])) {
      $data['bb_conductor']['status']['filter']['id'] = 'list_field';
      $data['bb_conductor']['status']['filter']['field_name'] = 'status';
      $data['bb_conductor']['status']['filter']['entity_type'] = 'bb_conductor';
    }

    if (isset($data['bb_conductor']['owner_user_id']['filter'])) {
      $data['bb_conductor']['owner_user_id']['filter']['id'] = 'entity_reference';
      $data['bb_conductor']['owner_user_id']['filter']['field_name'] = 'owner_user_id';
      $data['bb_conductor']['owner_user_id']['filter']['entity_type'] = 'bb_conductor';
    }

    return $data;
  }

}
