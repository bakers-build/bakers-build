<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\views\Entity\View;
use Symfony\Component\Yaml\Yaml;

/**
 * Supplies native Views routes to navigation tests without the ticket query.
 *
 * Full shipped View coverage lives in TicketListRouteTest and
 * TicketsContextualDisplayTest. These displays only exercise route generation
 * and bakers.build's route alterations, access checks, and navigation integration.
 */
trait TicketNavigationViewsTrait {

  /**
   * Creates page displays using the shipped ticket paths before router rebuild.
   */
  protected function installTicketNavigationViews(): void {
    // The tickets view moved out of bb_core/config/optional to its two homes
    // (config/sync + recipes/bakers/config) on BB-315; read the recipe copy.
    $shipped = Yaml::parseFile(dirname(DRUPAL_ROOT) . '/recipes/bakers/config/views.view.tickets.yml');
    $displays = [
      'default' => [
        'id' => 'default',
        'display_title' => 'Default',
        'display_plugin' => 'default',
        'position' => 0,
        'display_options' => [
          'access' => ['type' => 'none'],
        ],
      ],
    ];
    foreach (['project_tickets', 'team_tickets'] as $position => $id) {
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
      'id' => 'tickets',
      'label' => 'Ticket navigation routes',
      'base_table' => 'users_field_data',
      'base_field' => 'uid',
      'display' => $displays,
    ])->save();
  }

}
