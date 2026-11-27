<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * A listing row is its entity rendered in a row view mode.
 *
 * The listings arrange rows only: each listed entity renders through the row
 * view mode named here, so a row looks the same wherever it is listed. The
 * admin listings keep their field rows.
 */
#[Group('bb_core')]
final class ListingRowsConfigTest extends UnitTestCase {

  /**
   * Listings whose rows are rendered entities.
   *
   * Keyed by view, then display: the row view mode, the entity type and the
   * style that arranges the rows.
   */
  private const array ROWS = [
    'addons' => ['default' => ['bb_addon', 'list_item', 'bb_rows']],
    'conductors' => [
      'default' => ['bb_conductor', 'list_item', 'bb_rows'],
      'project_list' => ['bb_conductor', 'list_item', 'bb_rows'],
      'user_list' => ['bb_conductor', 'list_item', 'bb_rows'],
    ],
    'conductor_tickets' => ['default' => ['bb_ticket', 'list_item_compact', 'bb_rows']],
    'groups' => ['default' => ['bb_group', 'list_item', 'bb_rows']],
    'machines' => ['default' => ['bb_machine', 'list_item', 'bb_rows']],
    'projects' => ['default' => ['bb_project', 'list_item', 'bb_rows']],
    'runs' => [
      'default' => ['bb_run', 'list_item', 'bb_rows'],
      'project_runs' => ['bb_run', 'list_item', 'bb_rows'],
      'team_runs' => ['bb_run', 'list_item', 'bb_rows'],
    ],
    'tickets' => [
      'default' => ['bb_ticket', 'list_item', 'bb_rows'],
      'my_work' => ['bb_ticket', 'list_item', 'bb_rows'],
      'project_tickets' => ['bb_ticket', 'list_item', 'bb_rows'],
      'team_tickets' => ['bb_ticket', 'list_item', 'bb_rows'],
    ],
    'project_board' => ['default' => ['bb_ticket', 'board_card', 'bb_board']],
  ];

  /**
   * Admin listings that keep field rows.
   */
  private const array FIELD_ROW_VIEWS = [
    'bb_api_keys',
    'bb_service_accounts',
    'bb_terms',
    'bb_ticket_templates',
    'bb_ticket_triggers',
  ];

  /**
   * Each listing display renders its rows as entities in a row view mode.
   */
  #[DataProvider('rowDisplays')]
  public function testListingRendersEntitiesInRowViewMode(string $view_id, string $display_id, string $entity_type, string $view_mode, string $style): void {
    $options = $this->effectiveOptions($view_id, $display_id);
    self::assertSame($style, $options['style']['type'] ?? NULL, "$view_id:$display_id arranges rows with $style.");
    $row = $options['row'] ?? [];
    if (str_starts_with((string) $this->view($view_id)['base_table'], 'search_api_index_')) {
      self::assertSame('search_api', $row['type'] ?? NULL, "$view_id:$display_id renders indexed rows as entities.");
      self::assertSame($view_mode, $row['options']['view_modes']["entity:$entity_type"][$entity_type] ?? NULL, "$view_id:$display_id renders $entity_type in $view_mode.");
    }
    else {
      self::assertSame("entity:$entity_type", $row['type'] ?? NULL, "$view_id:$display_id renders rows as $entity_type entities.");
      self::assertSame($view_mode, $row['options']['view_mode'] ?? NULL, "$view_id:$display_id renders $entity_type in $view_mode.");
    }
    $mode = $this->config("core.entity_view_mode.$entity_type.$view_mode");
    self::assertSame("$entity_type.$view_mode", $mode['id'] ?? NULL, "The $view_mode view mode exists on $entity_type.");
    $display = $this->config("core.entity_view_display.$entity_type.$entity_type.$view_mode");
    self::assertTrue($display['status'] ?? FALSE, "$entity_type has an enabled $view_mode display.");
    self::assertNotEmpty($display['third_party_settings']['display_builder']['sources'] ?? [], "The $entity_type $view_mode row is built in Display Builder.");
  }

  /**
   * The admin listings keep the field-row list style.
   */
  public function testAdminListingsKeepFieldRows(): void {
    foreach (self::FIELD_ROW_VIEWS as $view_id) {
      $options = $this->effectiveOptions($view_id, 'default');
      self::assertSame('bb_list', $options['style']['type'] ?? NULL, "$view_id keeps bb_list.");
    }
  }

  /**
   * The listing displays under test.
   *
   * @return iterable<string, array{string, string, string, string, string}>
   *   View, display, entity type, view mode and style.
   */
  public static function rowDisplays(): iterable {
    foreach (self::ROWS as $view_id => $displays) {
      foreach ($displays as $display_id => [$entity_type, $view_mode, $style]) {
        yield "$view_id:$display_id" => [$view_id, $display_id, $entity_type, $view_mode, $style];
      }
    }
  }

  /**
   * The display options in effect, with overridden style and row resolved.
   *
   * @return array<string, mixed>
   *   The display options.
   */
  private function effectiveOptions(string $view_id, string $display_id): array {
    $displays = $this->view($view_id)['display'];
    self::assertArrayHasKey($display_id, $displays, "$view_id has a $display_id display.");
    $default = $displays['default']['display_options'];
    $options = $displays[$display_id]['display_options'] ?? [];
    foreach (['style', 'row'] as $key) {
      if (($options['defaults'][$key] ?? TRUE) !== FALSE || !isset($options[$key])) {
        $options[$key] = $default[$key] ?? [];
      }
    }
    return $options;
  }

  /**
   * A shipped view.
   *
   * @return array<string, mixed>
   *   The view config.
   */
  private function view(string $view_id): array {
    return $this->config("views.view.$view_id");
  }

  /**
   * A shipped config object, or an empty array when it is not exported.
   *
   * @return array<string, mixed>
   *   The config.
   */
  private function config(string $name): array {
    $file = dirname(__DIR__, 7) . "/config/sync/$name.yml";
    return is_file($file) ? Yaml::parseFile($file) : [];
  }

}
