<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * The project's computed `origin_sources` field.
 */
#[Group('bb_core')]
final class ProjectOriginSourcesTest extends ClaimKernelTestBase {

  /**
   * Two tickets of one GitLab repository and one Jira ticket give two links.
   */
  public function testDistinctSourcesOfViewableTickets(): void {
    $project = $this->project();
    $other = $this->otherProject();
    foreach ([
      [$project, 'https://gitlab.example.com/keytec/bakers/-/issues/12'],
      [$project, 'https://gitlab.example.com/keytec/bakers/-/issues/13'],
      [$project, 'https://acme.atlassian.net/browse/BIBB-7'],
      [$project, 'not a url'],
      [$project, ''],
      [$other, 'https://github.com/acme/app/issues/3'],
    ] as $i => [$target, $origin]) {
      $this->ticket($target, $i, $origin);
    }

    $viewer = $this->viewer($project);
    $this->container->get('current_user')->setAccount($viewer);

    $links = array_map(
      static fn ($item): array => ['title' => $item->getValue()['title'], 'uri' => $item->getValue()['uri']],
      iterator_to_array($project->get('origin_sources')),
    );
    self::assertSame([
      ['title' => 'GitLab - keytec/bakers', 'uri' => 'https://gitlab.example.com/keytec/bakers'],
      ['title' => 'Jira - BIBB', 'uri' => 'https://acme.atlassian.net/browse/BIBB'],
    ], $links);
  }

  /**
   * A viewer who may not read the project's tickets sees no source.
   */
  public function testNoSourceWithoutViewAccess(): void {
    $project = $this->project();
    $this->ticket($project, 1, 'https://github.com/acme/app/issues/3');
    $stranger = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'stranger', 'status' => 1]);
    $stranger->save();
    self::assertInstanceOf(UserInterface::class, $stranger);
    $this->container->get('current_user')->setAccount($stranger);

    self::assertTrue($project->get('origin_sources')->isEmpty());
  }

  /**
   * The project the claim fixture's conductor works in.
   */
  private function project(): BbProjectInterface {
    $project = $this->conductor->get('project_id')->entity;
    self::assertInstanceOf(BbProjectInterface::class, $project);
    return $project;
  }

  /**
   * Creates a ticket of a project with an Origin URL.
   */
  private function ticket(BbProjectInterface $project, int $n, string $origin): void {
    $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'identifier' => 'GL-O-' . $n,
      'workflow' => 'bb_work',
      'title' => 'T' . $n,
      'project_id' => $project->id(),
      'origin' => $origin,
    ])->save();
  }

  /**
   * Creates a second project in the same group, with a team of its own.
   */
  private function otherProject(): BbProjectInterface {
    $etm = $this->container->get('entity_type.manager');
    $group = $this->project()->get('group_id')->entity;
    assert($group instanceof ContentEntityInterface);
    $team = $etm->getStorage('bb_team')->create([
      'name' => 'Other team',
      'workspace_id' => $group->get('workspace_id')->target_id,
    ]);
    $team->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => 'Other',
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    return $project;
  }

  /**
   * Creates a viewer who reads the project through its team.
   */
  private function viewer(BbProjectInterface $project): UserInterface {
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'r_origin', 'label' => 'origin'])->save();
    user_role_grant_permissions('r_origin', ['view bb_ticket']);
    $account = $etm->getStorage('user')->create(['name' => 'origin-viewer', 'status' => 1, 'roles' => ['r_origin']]);
    $account->save();
    self::assertInstanceOf(UserInterface::class, $account);
    $group = $project->get('group_id')->entity;
    assert($group instanceof ContentEntityInterface);
    $workspace = $group->get('workspace_id')->entity;
    $this->addMembership($workspace, $account, ['member']);
    foreach ($project->get('teams')->referencedEntities() as $team) {
      $this->addMembership($team, $account);
    }
    return $account;
  }

}
