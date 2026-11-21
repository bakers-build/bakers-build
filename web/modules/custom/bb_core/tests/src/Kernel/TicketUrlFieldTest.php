<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbGroup;
use Drupal\bb_core\Entity\BbProject;
use Drupal\bb_core\Entity\BbTicket;
use Drupal\jsonapi\ResourceType\ResourceType;

/**
 * Tests the computed, absolute canonical url field on bb_ticket.
 *
 * @group bb_core
 *
 * @covers \Drupal\bb_core\Field\TicketUrlItemList
 */
final class TicketUrlFieldTest extends BbEntityKernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['serialization', 'jsonapi'];

  /**
   * A saved ticket serves its absolute workspace-scoped canonical URL.
   */
  public function testUrlIsAbsoluteCanonical(): void {
    $admin = $this->createUser([], NULL, TRUE);
    self::assertInstanceOf(AccountInterface::class, $admin);
    $this->setCurrentUser($admin);

    self::assertNotNull($this->hostWorkspace);
    $group = BbGroup::create(['name' => 'Acme group', 'workspace_id' => $this->hostWorkspace->id()]);
    $group->save();
    $project = BbProject::create(['name' => 'acme', 'key' => 'ACME', 'group_id' => $group->id()]);
    $project->save();
    $ticket = BbTicket::create([
      'title' => 'T',
      'workflow' => 'bb_work',
      'project_id' => $project->id(),
    ]);
    $ticket->save();

    self::assertMatchesRegularExpression('#^https?://[^/]+/acme/ticket/acme-1$#', (string) $ticket->get('url')->value);
  }

  /**
   * An unsaved ticket has no address yet.
   */
  public function testUrlEmptyForNewTicket(): void {
    $ticket = BbTicket::create(['title' => 'T', 'workflow' => 'bb_work']);

    self::assertTrue($ticket->get('url')->isEmpty());
  }

  /**
   * JSON:API serves the field as the attribute `url`.
   */
  public function testUrlIsExposedByJsonApi(): void {
    $this->installConfig(['jsonapi']);
    $resource_type = $this->container->get('jsonapi.resource_type.repository')
      ->get('bb_ticket', 'bb_ticket');
    self::assertInstanceOf(ResourceType::class, $resource_type);

    self::assertTrue($resource_type->isFieldEnabled('url'));
    self::assertSame('url', $resource_type->getPublicName('url'));
  }

}
