<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Tests\bb_core\Kernel\Tool\BakersToolTestBase;
use Drupal\Tests\bb_core\Kernel\Tool\ForeignWorkspaceTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The post-update renames the deployment type and its recipe to ship.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ShipRenameUpdateTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * Terms become ship, merging into an existing ship; tickets keep the rest.
   */
  public function testRenamesTypeAndRecipeToShip(): void {
    $this->installEntitySchema('bb_environment');
    $production = (int) $this->entity('bb_environment', ['name' => 'production', 'project_id' => $this->project->id()])->id();
    $carried = $this->ticket('SR-C');
    $type = $this->term('type', 'deployment');
    $recipe = $this->term('recipe', 'deploy-and-release');
    $renamed = $this->ticket('SR-1', [
      'ticket_type' => $type->id(),
      'recipe' => $recipe->id(),
      'state' => 'review',
      'environments' => [$production],
      'referenced_tickets' => [$carried->id()],
    ]);
    // A second workspace already holds ship: its deployment merges into it.
    $other = $this->entity('bb_workspace', ['name' => 'other', 'slug' => 'other']);
    $old = $this->entity('bb_term', ['vid' => 'type', 'name' => 'deployment', 'workspace_id' => $other->id()]);
    $ship = $this->entity('bb_term', ['vid' => 'type', 'name' => 'ship', 'workspace_id' => $other->id()]);
    $merged = $this->ticket('SR-2', ['ticket_type' => $old->id()]);

    $this->container->get('module_handler')->loadInclude('bb_core', 'php', 'bb_core.post_update');
    bb_core_post_update_rename_deployment_to_ship();

    $terms = $this->container->get('entity_type.manager')->getStorage('bb_term');
    self::assertSame([], $terms->loadByProperties(['vid' => 'type', 'name' => 'deployment']));
    self::assertSame([], $terms->loadByProperties(['vid' => 'recipe', 'name' => 'deploy-and-release']));
    self::assertCount(1, $terms->loadByProperties(['vid' => 'type', 'name' => 'ship', 'workspace_id' => $other->id()]));

    $renamed = $this->reload($renamed);
    self::assertSame('ship', $renamed->get('ticket_type')->entity?->label());
    self::assertSame('ship', $renamed->get('recipe')->entity?->label());
    self::assertSame('review', $renamed->get('state')->value);
    self::assertSame([$production], $this->ids($renamed, 'environments'));
    self::assertSame([(int) $carried->id()], $this->ids($renamed, 'referenced_tickets'));
    self::assertSame((int) $ship->id(), (int) $this->reload($merged)->get('ticket_type')->target_id);
  }

  /**
   * The stored ticket's reference ids, in order.
   *
   * @return array<int>
   *   Target ids.
   */
  private function ids(BbTicketInterface $ticket, string $field): array {
    return array_map('intval', array_column($ticket->get($field)->getValue(), 'target_id'));
  }

}
