<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Hook\Attribute\Hook;

/**
 * Integrates bakers.build entity forms with the Gin admin theme.
 *
 * Registers all bakers.build entity add/edit routes as content form routes so
 * that Gin renders them with the full sidebar layout instead of the basic admin
 * page wrapper.
 */
final class GinIntegrationHooks {

  /**
   * Returns bakers.build entity form routes Gin should treat as content forms.
   *
   * @return string[]
   *   Array of route names for bakers.build entity add and edit forms.
   */
  #[Hook('gin_content_form_routes')]
  public function ginContentFormRoutes(): array {
    $routes = [];
    foreach ([
      'bb_group',
      'bb_project',
      'bb_ticket',
      'bb_conductor',
      'bb_run',
    ] as $entity_type_id) {
      $routes[] = "entity.$entity_type_id.add_form";
      $routes[] = "entity.$entity_type_id.edit_form";
    }
    // Ticket Settings render in the app shell, never in the admin theme.
    return array_values(array_diff($routes, ['entity.bb_ticket.edit_form']));
  }

}
