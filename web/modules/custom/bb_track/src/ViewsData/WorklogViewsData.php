<?php

declare(strict_types=1);

namespace Drupal\bb_track\ViewsData;

use Drupal\views\EntityViewsData;

/**
 * Views data for personal Worklog listings.
 */
final class WorklogViewsData extends EntityViewsData {

  /**
   * {@inheritdoc}
   */
  public function getViewsData(): array {
    $data = parent::getViewsData();

    $data['bb_track_worklog']['bb_worklog_period'] = [
      'title' => $this->t('Period'),
      'help' => $this->t('Calendar context, day or week, date and filters of the time calendar.'),
      'filter' => ['id' => 'bb_worklog_period'],
    ];

    return $data;
  }

}
