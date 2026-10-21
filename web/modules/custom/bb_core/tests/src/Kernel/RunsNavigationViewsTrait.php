<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\views\Entity\View;
use Symfony\Component\Yaml\Yaml;

/**
 * Supplies the runs view's native routes to navigation tests (BB-454).
 *
 * Mirrors `TicketNavigationViewsTrait`: a stub `View`, based on a table that
 * needs no Search API server, that carries the SAME id and display paths as
 * the shipped `views.view.runs`, so route generation, access checks and
 * navigation integration can be exercised without indexing anything. Full
 * shipped View coverage is the structure functional test
 *.
 */
trait RunsNavigationViewsTrait {

  /**
   * Creates page displays using the shipped run paths before router rebuild.
   */
  protected function installRunsNavigationViews(): void {
    $shipped = Yaml::parseFile(dirname(DRUPAL_ROOT) . '/recipes/bakers/config/views.view.runs.yml');
    $displays = [
      'default' => [
        'id' => 'default',
        'display_title' => 'Default',
        'display_plugin' => 'default',
        'position' => 0,
        'display_options' => [
          'access' => ['type' => 'perm', 'options' => ['perm' => 'view bb_run']],
        ],
      ],
    ];
    foreach (['project_runs', 'team_runs'] as $position => $id) {
      $displays[$id] = [
        'id' => $id,
        'display_title' => $shipped['display'][$id]['display_title'],
        'display_plugin' => 'page',
        'position' => $position + 1,
        'display_options' => [
          'path' => $shipped['display'][$id]['display_options']['path'],
        ],
      ];
    }
    View::create([
      'id' => 'runs',
      'label' => 'Run navigation routes',
      'base_table' => 'users_field_data',
      'base_field' => 'uid',
      'display' => $displays,
    ])->save();
  }

}
