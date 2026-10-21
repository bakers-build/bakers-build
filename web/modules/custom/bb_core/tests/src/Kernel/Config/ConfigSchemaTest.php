<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Config;

use Drupal\Core\Config\Schema\SchemaCheckTrait;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Proves the composite statistics configuration is fully typed.
 */
#[Group('bb_core')]
final class ConfigSchemaTest extends KernelTestBase {

  use SchemaCheckTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['file', 'image', 'system', 'user', 'bb_core'];

  /**
   * Every new configuration entity has complete schema.
   */
  public function testCompositeStatisticsSchemas(): void {
    $samples = [
      'bb_core.bb_measurement.closed_tickets' => [
        'id' => 'closed_tickets',
        'label' => 'Closed tickets',
        'value_type' => 'integer',
        'unit' => 'tickets',
        'source' => ['entity_type' => 'bb_ticket', 'time_field' => 'closed_date'],
        'operation' => ['type' => 'count'],
        'predicates' => [['field' => 'closed', 'operator' => '=', 'value' => TRUE]],
        'bindings' => ['project' => ['field' => 'project_id', 'resolver' => 'entity_id']],
        'dimensions' => ['project' => ['field' => 'project_id', 'entity_type' => 'bb_project']],
      ],
      'bb_core.bb_figure.project_overview' => [
        'id' => 'project_overview',
        'label' => 'Project overview',
        'description' => 'Project throughput windows.',
        'weight' => 0,
        'widget' => 'matrix',
        'measurements' => ['closed_tickets', 'runs'],
        'categories' => ['type' => 'windows', 'values' => ['day', 'week', 'month']],
        'filters' => [],
        'context_shape' => ['project'],
        'conditions' => [
          'project' => [
            'id' => 'bb_route_context',
            'entity_type' => 'bb_project',
            'negate' => FALSE,
            'context_mapping' => ['entity' => 'project'],
          ],
        ],
      ],
      'bb_core.bb_figure_group.overview' => [
        'id' => 'overview',
        'label' => 'Overview',
        'weight' => 0,
        'figures' => ['project_overview'],
      ],
    ];

    foreach ($samples as $name => $data) {
      $result = $this->checkConfigSchema($this->container->get('config.typed'), $name, $data);
      self::assertTrue($result === TRUE, sprintf('%s schema errors: %s', $name, print_r($result, TRUE)));
    }
  }

}
