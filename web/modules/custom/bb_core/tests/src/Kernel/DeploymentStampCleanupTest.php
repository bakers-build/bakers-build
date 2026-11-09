<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\EntityInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Tests\bb_core\Kernel\Tool\BakersToolTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The post-update removes environments past deploys stamped onto tickets.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class DeploymentStampCleanupTest extends BakersToolTestBase {

  /**
   * Only environments a referencing deployment records leave a ticket.
   */
  public function testRemovesStampsTheDeploymentRecords(): void {
    $this->installEntitySchema('bb_environment');
    $env = fn (string $name): int => (int) $this->entity('bb_environment', [
      'name' => $name,
      'project_id' => $this->project->id(),
    ])->id();
    [$production, $staging, $preview] = [$env('production'), $env('staging'), $env('preview')];
    $type = $this->term('type', 'deployment')->id();
    $ticket = $this->ticket('SC-T', ['environments' => [$production, $staging]]);
    $closed = $this->ticket('SC-C', ['environments' => [$production], 'state' => 'done']);
    $untouched = $this->ticket('SC-V', ['environments' => [$production]]);
    $other = $this->ticket('SC-D3', ['ticket_type' => $type, 'environments' => [$preview, $production]]);
    $deployment = $this->ticket('SC-D1', [
      'ticket_type' => $type,
      'environments' => [$production],
      'referenced_tickets' => [$ticket->id(), $closed->id(), $other->id()],
    ]);

    $this->container->get('module_handler')->loadInclude('bb_core', 'php', 'bb_core.post_update');
    $sandbox = [];
    do {
      bb_core_post_update_clear_deployment_stamps($sandbox);
    } while ($sandbox['#finished'] < 1);

    self::assertSame([$staging], $this->environmentIds($ticket));
    self::assertSame([], $this->environmentIds($closed));
    self::assertSame([$production], $this->environmentIds($untouched));
    self::assertSame([$preview, $production], $this->environmentIds($other));
    self::assertSame([$production], $this->environmentIds($deployment));
  }

  /**
   * The stored ticket's environment ids, in order.
   *
   * @return array<int>
   *   Environment ids.
   */
  private function environmentIds(BbTicketInterface $ticket): array {
    return array_map('intval', array_column($this->reload($ticket)->get('environments')->getValue(), 'target_id'));
  }

  /**
   * Creates an entity of the given type with the given values.
   *
   * @param string $type
   *   The entity type id.
   * @param array<string, mixed> $values
   *   Field values.
   */
  private function entity(string $type, array $values): EntityInterface {
    $entity = $this->container->get('entity_type.manager')->getStorage($type)->create($values);
    $entity->save();
    return $entity;
  }

}
