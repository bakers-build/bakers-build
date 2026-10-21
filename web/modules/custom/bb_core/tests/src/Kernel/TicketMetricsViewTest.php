<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\views\Entity\View;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies the type-level bb_metric Views handlers (BB-172 AC-3).
 *
 * The value column is exposed per ticket by metric name and aggregates
 * (AVG 0.7) across tickets, all keyed on the field TYPE so any bb_metric
 * field inherits the handlers.
 */
#[Group('bb_core')]
final class TicketMetricsViewTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'views', 'bb_core', 'bb_metric_views_test',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    // The View runs an access-checked query since BB-305, so the account it
    // executes as must be able to view the rows. This test is about the metric
    // field plugin, not about access.
    $this->setUpCurrentUser([], [
      'view bb_ticket',
      // Plus `administer bakers` since BB-318: the workspace read scope
      // narrows every access-checked collection query to the acting
      // account's OG memberships, and reference validation runs one. The
      // type's admin permission is the documented bypass (D7 guard 2) — the
      // right fix for a test whose subject is not read access, and the
      // alternative to inventing a workspace chain it does not otherwise
      // need. The read scope itself is covered by WorkspaceReadScope*Test.
      'administer bakers',
    ]);
    $this->createTicketWithRate('T-1', '0.8000');
    $this->createTicketWithRate('T-2', '0.6000');
  }

  /**
   * Creates a ticket carrying an ac_pass_rate metric plus a distractor.
   */
  private function createTicketWithRate(string $identifier, string $rate): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'identifier' => $identifier,
      'workflow' => 'bb_feature',
      'title' => $identifier,
      'metrics' => [
        ['name' => 'review_bounces', 'value' => '9.0000'],
        ['name' => 'ac_pass_rate', 'value' => $rate, 'unit' => 'ratio'],
      ],
    ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * The bb_metric field handler exposes the value of the named metric.
   */
  public function testMetricFieldExposesValueByName(): void {
    $view = View::create([
      'id' => 'bb_metric_field_test',
      'label' => 'metric field test',
      'base_table' => 'bb_ticket',
      'display' => [
        'default' => [
          'display_plugin' => 'default',
          'id' => 'default',
          'display_options' => [
            'fields' => [
              'metrics_value' => [
                'table' => 'bb_ticket__metrics',
                'field' => 'metrics_value',
                'id' => 'metrics_value',
                'plugin_id' => 'bb_metric',
                'entity_type' => 'bb_ticket',
                'metric_name' => 'ac_pass_rate',
              ],
            ],
          ],
        ],
      ],
    ]);
    $view->save();

    $executable = Views::getView('bb_metric_field_test');
    $executable->execute();
    $values = [];
    foreach ($executable->result as $row) {
      $values[] = (float) $executable->field['metrics_value']->getValue($row);
    }
    sort($values);
    $this->assertSame([0.6, 0.8], $values);
  }

  /**
   * Two field columns pinned to different metric names coexist in one view.
   *
   * Regression (BB-172 finding 2): both handlers target the same multi-value
   * field, so a shared join alias would AND their name predicates
   * (name = A AND name = B) into a contradiction → zero rows. Each pinned
   * handler must get its own join alias so both columns resolve.
   */
  public function testTwoPinnedMetricsCoexistInOneView(): void {
    $view = View::create([
      'id' => 'bb_metric_multi_test',
      'label' => 'metric multi test',
      'base_table' => 'bb_ticket',
      'display' => [
        'default' => [
          'display_plugin' => 'default',
          'id' => 'default',
          'display_options' => [
            'fields' => [
              'metrics_value' => [
                'table' => 'bb_ticket__metrics',
                'field' => 'metrics_value',
                'id' => 'metrics_value',
                'plugin_id' => 'bb_metric',
                'entity_type' => 'bb_ticket',
                'metric_name' => 'ac_pass_rate',
              ],
              'metrics_value_1' => [
                'table' => 'bb_ticket__metrics',
                'field' => 'metrics_value',
                'id' => 'metrics_value_1',
                'plugin_id' => 'bb_metric',
                'entity_type' => 'bb_ticket',
                'metric_name' => 'review_bounces',
              ],
            ],
          ],
        ],
      ],
    ]);
    $view->save();

    $executable = Views::getView('bb_metric_multi_test');
    $executable->execute();
    $this->assertCount(2, $executable->result);
    $rates = [];
    $bounces = [];
    foreach ($executable->result as $row) {
      $rates[] = (float) $executable->field['metrics_value']->getValue($row);
      $bounces[] = (float) $executable->field['metrics_value_1']->getValue($row);
    }
    sort($rates);
    $this->assertSame([0.6, 0.8], $rates);
    $this->assertSame([9.0, 9.0], $bounces);
  }

  /**
   * The value aggregates (AVG) across tickets, pinned to the metric name.
   */
  public function testAggregateAveragesValueAcrossTickets(): void {
    $view = View::create([
      'id' => 'bb_metric_agg_test',
      'label' => 'metric agg test',
      'base_table' => 'bb_ticket',
      'display' => [
        'default' => [
          'display_plugin' => 'default',
          'id' => 'default',
          'display_options' => [
            'group_by' => TRUE,
            'fields' => [
              'metrics_value' => [
                'table' => 'bb_ticket__metrics',
                'field' => 'metrics_value',
                'id' => 'metrics_value',
                'plugin_id' => 'bb_metric',
                'entity_type' => 'bb_ticket',
                'group_type' => 'avg',
              ],
            ],
            'filters' => [
              'metrics_name' => [
                'table' => 'bb_ticket__metrics',
                'field' => 'metrics_name',
                'id' => 'metrics_name',
                'plugin_id' => 'bb_metric_name',
                'entity_type' => 'bb_ticket',
                'operator' => '=',
                'value' => 'ac_pass_rate',
              ],
            ],
          ],
        ],
      ],
    ]);
    $view->save();

    $executable = Views::getView('bb_metric_agg_test');
    $executable->execute();
    $this->assertCount(1, $executable->result);
    $avg = (float) $executable->field['metrics_value']->getValue($executable->result[0]);
    $this->assertEqualsWithDelta(0.7, $avg, 0.0001);
  }

}
