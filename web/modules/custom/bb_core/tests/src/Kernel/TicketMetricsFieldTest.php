<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Verifies bb_ticket.metrics carries multiple named metrics (BB-172).
 *
 * A ticket carries arbitrary named success metrics; adding a new metric name
 * needs no schema change (AC-1).
 */
#[Group('bb_core')]
final class TicketMetricsFieldTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
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
  }

  /**
   * Creates and saves a minimal ticket.
   */
  private function createTicket(string $identifier): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['identifier' => $identifier, 'workflow' => 'bb_feature', 'title' => $identifier]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Reloads a ticket from storage.
   */
  private function reloadTicket(BbTicketInterface $ticket): BbTicketInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([$ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * A ticket carries multiple named metrics; a new name needs no schema change.
   */
  public function testTicketCarriesMultipleNamedMetrics(): void {
    $ticket = $this->createTicket('GL-100');
    $ticket->set('metrics', [
      ['name' => 'ac_pass_rate', 'value' => '0.8000', 'unit' => 'ratio', 'recorded' => 1700000000],
      ['name' => 'review_bounces', 'value' => '2.0000'],
      ['name' => 'time_to_done_h', 'value' => '34.0000', 'unit' => 'h'],
    ]);
    $ticket->save();

    $reloaded = $this->reloadTicket($ticket);
    $this->assertCount(3, $reloaded->get('metrics'));
    $this->assertSame('ac_pass_rate', $reloaded->get('metrics')[0]->get('name')->getValue());
    // Numeric comparison: the returned scale belongs to the database, not
    // the field. See BbMetricFieldTypeTest::testSchemaAndRoundTrip().
    $value = $reloaded->get('metrics')[0]->get('value')->getValue();
    $this->assertEqualsWithDelta(0.8, (float) $value, 0.00001);

    // A brand-new metric name needs no schema change.
    $reloaded->get('metrics')->appendItem(['name' => 'brand_new_metric', 'value' => '1.0000']);
    $reloaded->save();
    $this->assertCount(4, $this->reloadTicket($reloaded)->get('metrics'));
  }

  /**
   * A fresh install already has the metrics storage (AC-5).
   *
   * BaseFieldDefinitions creates the column on a fresh install.
   */
  public function testFreshInstallHasMetricsStorage(): void {
    $storage_definitions = $this->container->get('entity_field.manager')
      ->getFieldStorageDefinitions('bb_ticket');
    $this->assertArrayHasKey('metrics', $storage_definitions);
    $this->assertSame('bb_metric', $storage_definitions['metrics']->getType());
  }

}
