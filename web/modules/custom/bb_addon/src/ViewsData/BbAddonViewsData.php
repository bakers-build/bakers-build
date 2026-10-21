<?php

declare(strict_types=1);

namespace Drupal\bb_addon\ViewsData;

use Drupal\views\EntityViewsData;

/**
 * Views data for bb_addon.
 *
 * Adds the column-less `newest_per_name` filter, which keeps one row per
 * addon name: its newest version.
 */
final class BbAddonViewsData extends EntityViewsData {

  /**
   * {@inheritdoc}
   */
  public function getViewsData(): array {
    $data = parent::getViewsData();
    $data['bb_addon']['newest_per_name'] = [
      'title' => $this->t('Newest version of each name'),
      'help' => $this->t('Keeps only the newest row (created, then id) of each addon name.'),
      'filter' => ['id' => 'bb_addon_newest_per_name'],
    ];
    return $data;
  }

}
