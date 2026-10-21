<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Builds the workspace -> group -> project -> ticket -> run entity chain.
 *
 * Several Kernel suites need a run that resolves to a real workspace through
 * WorkspaceResolverInterface rather than mocking the resolver, so the chain
 * lives here once instead of once per test class.
 */
trait WorkspaceFixtureTrait {

  /**
   * Distinguishes repeated calls within the same test.
   */
  private int $workspaceFixtureSequence = 0;

  /**
   * Creates a run at the end of a fresh workspace -> ... -> ticket chain.
   */
  protected function createRunInWorkspace(): BbRunInterface {
    $suffix = ++$this->workspaceFixtureSequence;
    $etm = $this->container->get('entity_type.manager');

    $workspace = $etm->getStorage('bb_workspace')->create([
      'name' => 'Workspace ' . $suffix,
      'slug' => 'workspace-' . $suffix,
    ]);
    $workspace->save();

    $group = $etm->getStorage('bb_group')->create([
      'name' => 'Group ' . $suffix,
      'workspace_id' => $workspace->id(),
    ]);
    $group->save();

    $project = $etm->getStorage('bb_project')->create([
      'name' => 'Project ' . $suffix,
      'key' => 'PRJ' . $suffix,
      'group_id' => $group->id(),
    ]);
    $project->save();

    $ticket = $etm->getStorage('bb_ticket')->create([
      'title' => 'Ticket ' . $suffix,
      'project_id' => $project->id(),
    ]);
    $ticket->save();

    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
    ]);
    $run->save();

    self::assertInstanceOf(BbRunInterface::class, $run);
    return $run;
  }

  /**
   * Creates a second, unrelated workspace with no group, project or ticket.
   */
  protected function createSecondWorkspace(): BbWorkspaceInterface {
    $suffix = ++$this->workspaceFixtureSequence;
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Workspace ' . $suffix, 'slug' => 'workspace-' . $suffix]);
    $workspace->save();

    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    return $workspace;
  }

}
