<?php

declare(strict_types=1);

namespace Drupal\bb_core\ViewsData;

use Drupal\views\EntityViewsData;

/**
 * Views data for environments: the project filter offers one workspace.
 */
final class BbEnvironmentViewsData extends EntityViewsData {

  /**
   * {@inheritdoc}
   */
  public function getViewsData(): array {
    $data = parent::getViewsData();
    $data['bb_environment']['project_id']['filter']['id'] = 'bb_workspace_project';
    return $data;
  }

}
