<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Deployment\DeploymentLookup;
use Drupal\Tests\bb_core\Kernel\Tool\BakersToolTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Deployment presentation respects project, access and completion boundaries.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class DeploymentLookupTest extends BakersToolTestBase {

  /**
   * Project rows are newest first and count only accessible project work.
   */
  public function testProjectListNewestFirstWithCounts(): void {
    $this->installEntitySchema('bb_environment');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_environment');
    $develop = $storage->create(['name' => 'develop', 'project_id' => $this->project->id()]);
    $develop->save();
    $production = $storage->create(['name' => 'production', 'project_id' => $this->project->id()]);
    $production->save();
    $foreign = $this->project->createDuplicate();
    $foreign->save();
    $type = $this->term('type', 'deployment')->id();
    $first = $this->ticket('LOOK-1');
    $second = $this->ticket('LOOK-2');
    $other = $this->ticket('OTHER-1', ['project_id' => $foreign->id()]);
    $older = $this->ticket('LOOK-D1', [
      'ticket_type' => $type, 'created' => 100,
      'referenced_tickets' => [$first->id(), $second->id(), $other->id()],
      'environments' => [$develop->id(), $production->id()],
    ]);
    $newer = $this->ticket('LOOK-D2', [
      'ticket_type' => $type, 'created' => 200,
      'referenced_tickets' => [$first->id(), $older->id()],
      'environments' => [$develop->id()],
    ]);
    $rows = $this->container->get('bb_core.deployment_lookup')->projectDeployments($this->project);
    self::assertSame([$newer->id(), $older->id()], array_map(static fn(array $row) => $row['ticket']->id(), $rows));
    self::assertSame([1, 2], array_column($rows, 'count'));
    self::assertSame([['develop'], ['develop', 'production']], array_column($rows, 'environments'));
    self::assertSame([200, 100], array_column($rows, 'created'));
  }

  /**
   * A foreign project's deployment contributes badges, but no project row.
   */
  public function testForeignProjectDeploymentNotListed(): void {
    $foreign = $this->project->createDuplicate();
    $foreign->save();
    $ticket = $this->ticket('LOOK-1');
    $this->ticket('OTHER-D1', [
      'project_id' => $foreign->id(),
      'ticket_type' => $this->term('type', 'deployment')->id(),
      'referenced_tickets' => [$ticket->id()],
    ]);
    self::assertSame([], $this->container->get('bb_core.deployment_lookup')->projectDeployments($this->project));
  }

  /**
   * A viewer without read access receives neither rows nor badges.
   */
  public function testUnreadableDeploymentHidden(): void {
    $ticket = $this->ticket('LOOK-1');
    $this->ticket('LOOK-D1', [
      'ticket_type' => $this->term('type', 'deployment')->id(),
      'referenced_tickets' => [$ticket->id()],
      'closed' => TRUE,
    ]);
    $this->container->get('current_user')->setAccount($this->account('outsider'));
    $lookup = $this->container->get('bb_core.deployment_lookup');
    self::assertSame([], $lookup->projectDeployments($this->project));
    self::assertSame([], $lookup->deployedEnvironments($ticket));
  }

  /**
   * Open deployments contribute no badge; closed environments are distinct.
   */
  public function testBadgesOnlyFromClosedAndDeduplicated(): void {
    $this->installEntitySchema('bb_environment');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_environment');
    $develop = $storage->create(['name' => 'develop', 'project_id' => $this->project->id()]);
    $develop->save();
    $production = $storage->create(['name' => 'production', 'project_id' => $this->project->id()]);
    $production->save();
    $ticket = $this->ticket('LOOK-1');
    $values = [
      'ticket_type' => $this->term('type', 'deployment')->id(),
      'referenced_tickets' => [$ticket->id()],
      'environments' => [$develop->id()],
    ];
    $this->ticket('LOOK-OPEN', $values);
    $lookup = $this->container->get('bb_core.deployment_lookup');
    self::assertInstanceOf(DeploymentLookup::class, $lookup);
    self::assertSame([], $lookup->deployedEnvironments($ticket));
    $this->ticket('LOOK-C1', ['closed' => TRUE, 'created' => 100] + $values);
    $this->ticket('LOOK-C2', ['closed' => TRUE, 'created' => 200] + $values);
    $foreign = $this->project->createDuplicate();
    $foreign->save();
    $this->ticket('OTHER-C3', [
      'closed' => TRUE, 'created' => 300, 'project_id' => $foreign->id(),
      'environments' => [$production->id()],
    ] + $values);
    self::assertSame(['develop', 'production'], $lookup->deployedEnvironments($ticket));
    self::assertSame([(int) $ticket->id() => ['develop', 'production']], $lookup->deployedEnvironmentsMultiple([$ticket]));
  }

  /**
   * A deployment without a target is listed but contributes no badge.
   */
  public function testDeploymentWithoutEnvironment(): void {
    $this->installEntitySchema('bb_environment');
    $ticket = $this->ticket('LOOK-1');
    $this->ticket('LOOK-D1', [
      'ticket_type' => $this->term('type', 'deployment')->id(),
      'referenced_tickets' => [$ticket->id()], 'closed' => TRUE,
    ]);
    $lookup = $this->container->get('bb_core.deployment_lookup');
    self::assertSame([], $lookup->projectDeployments($this->project)[0]['environments']);
    self::assertSame([], $lookup->deployedEnvironments($ticket));
  }

}
