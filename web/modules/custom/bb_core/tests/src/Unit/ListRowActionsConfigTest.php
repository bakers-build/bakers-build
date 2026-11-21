<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * A product list row is one link to its entity; its actions are on the detail.
 *
 * Fails for every shipped view display outside `/admin` that renders a row
 * action: core's entity operations menu or one of the deny-listed row-action
 * fields. Admin listings keep their operations.
 */
#[Group('bb_core')]
final class ListRowActionsConfigTest extends UnitTestCase {

  /**
   * Views field plugins that put an action into a list row.
   */
  private const array DENIED_PLUGINS = [
    'entity_operations',
    'bb_ticket_trigger_actions',
    'bb_service_account_actions',
    'bb_api_key_revoke_link',
  ];

  /**
   * No display outside `/admin` carries a row action.
   */
  public function testProductListRowsCarryNoActions(): void {
    $offending = [];
    $files = glob(dirname(__DIR__, 7) . '/config/sync/views.view.*.yml') ?: [];
    self::assertNotEmpty($files, 'The guard reads the exported views.');
    foreach ($files as $file) {
      $view = Yaml::parseFile($file);
      $displays = $view['display'] ?? [];
      $defaultFields = $displays['default']['display_options']['fields'] ?? [];
      foreach ($displays as $id => $display) {
        $options = $display['display_options'] ?? [];
        $path = (string) ($options['path'] ?? '');
        // The default display renders only through the displays that use it.
        if ($id === 'default' || $path === 'admin' || str_starts_with($path, 'admin/')) {
          continue;
        }
        $fields = ($options['defaults']['fields'] ?? TRUE) === FALSE ? ($options['fields'] ?? []) : $defaultFields;
        foreach ($fields as $name => $field) {
          if (in_array($field['plugin_id'] ?? '', self::DENIED_PLUGINS, TRUE)) {
            $offending[] = sprintf('%s:%s:%s (%s)', $view['id'], $id, $name, $field['plugin_id']);
          }
        }
      }
    }
    self::assertSame([], $offending, 'List rows outside /admin link to the entity; actions belong on its detail.');
  }

}
