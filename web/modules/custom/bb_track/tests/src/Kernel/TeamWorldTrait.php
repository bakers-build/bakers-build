<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;

/**
 * Two workspaces with one team each, for team-lead time visibility.
 *
 * W1 holds team T1 (lead L, active member M, blocked Mb, pending Mp) and
 * project P1; W2 holds team T2 (members M2 and M) and project P2. WL leads
 * W1 without any team role. Hosts use OgScopeFixtureTrait and
 * UserCreationTrait.
 */
trait TeamWorldTrait {

  use BillingAccountFixtureTrait;

  /**
   * Team world entities keyed by their short name.
   *
   * @var array<string, mixed>
   */
  protected array $world = [];

  /**
   * Builds the team world once per test.
   *
   * @return array<string, mixed>
   *   Users O (owner of both teams, so an active member through OG's
   *   owner auto-membership), L, M, Mb, Mp, M2, WL; workspaces W1, W2;
   *   teams T1, T2; projects P1, P2.
   */
  protected function createTeamWorld(): array {
    if ($this->world !== []) {
      return $this->world;
    }
    $permissions = [
      'record own worklog',
      'view bb_project',
      'view bb_ticket',
      'view bb_group',
    ];
    $owner = $this->createUser([], 'team-world-owner');
    assert($owner instanceof UserInterface);
    $users = [];
    $names = [
      'L' => 'lead-l',
      'M' => 'member-m',
      'Mb' => 'blocked-mb',
      'Mp' => 'pending-mp',
      'M2' => 'member-m2',
      'WL' => 'workspace-lead-wl',
    ];
    foreach ($names as $key => $name) {
      $user = $this->createUser($permissions, $name);
      assert($user instanceof UserInterface);
      $users[$key] = $user;
    }
    $types = $this->container->get('entity_type.manager');
    $workspaces = [];
    $teams = [];
    $projects = [];
    foreach (['1', '2'] as $n) {
      $workspace = $types->getStorage('bb_workspace')->create([
        'name' => "Team world $n",
        'slug' => "team-world-$n",
        'owner_user_id' => $owner->id(),
      ]);
      $workspace->save();
      assert($workspace instanceof BbWorkspaceInterface);
      $team = $types->getStorage('bb_team')->create([
        'name' => "Team $n",
        'workspace_id' => $workspace->id(),
        'owner_user_id' => $owner->id(),
      ]);
      $team->save();
      assert($team instanceof BbTeamInterface);
      $group = $types->getStorage('bb_group')->create([
        'name' => "Customer $n",
        'workspace_id' => $workspace->id(),
        'owner_user_id' => $owner->id(),
      ]);
      $group->save();
      assert($group instanceof BbGroupInterface);
      $project = $types->getStorage('bb_project')->create([
        'name' => "Project $n",
        'key' => "TWP$n",
        'teams' => [$team->id()],
        'group_id' => $group->id(),
        'owner_user_id' => $owner->id(),
      ]);
      $project->save();
      assert($project instanceof BbProjectInterface);
      $this->attachBillingAccount($project);
      $workspaces["W$n"] = $workspace;
      $teams["T$n"] = $team;
      $projects["P$n"] = $project;
    }
    foreach (['L', 'M', 'Mb', 'Mp'] as $key) {
      $this->addMembership($workspaces['W1'], $users[$key], ['contributor']);
    }
    $this->addMembership($workspaces['W1'], $users['WL'], ['lead']);
    $this->addMembership($workspaces['W2'], $users['M2'], ['contributor']);
    $this->addMembership($workspaces['W2'], $users['M'], ['contributor']);
    $this->addMembership($teams['T1'], $users['L'], ['lead']);
    $this->addMembership($teams['T1'], $users['M']);
    $this->addMembership($teams['T1'], $users['WL']);
    $this->addMembership($teams['T1'], $users['Mb'])
      ->setState(OgMembershipInterface::STATE_BLOCKED)->save();
    $this->addMembership($teams['T1'], $users['Mp'])
      ->setState(OgMembershipInterface::STATE_PENDING)->save();
    $this->addMembership($teams['T2'], $users['M2']);
    $this->addMembership($teams['T2'], $users['M']);
    $this->container->get('cache.static')->deleteAll();
    $this->world = ['O' => $owner] + $users + $workspaces + $teams + $projects;
    return $this->world;
  }

  /**
   * Stores a recorded team-world entry.
   */
  protected function teamEntry(string $owner, string $project, array $values = []): Worklog {
    $entry = Worklog::create([
      'owner_user_id' => $this->world[$owner]->id(),
      'work_date' => $values['work_date'] ?? '2026-12-08',
      'timezone' => 'UTC',
      'duration_seconds' => $values['duration_seconds'] ?? 3600,
      'description' => $values['description'] ?? "$owner on $project",
      'derivation' => 'manual',
      'state' => 'recorded',
      'project_id' => $this->world[$project]->id(),
    ]);
    LegacyWorklogFixture::save($entry);
    if (!empty($values['voided'])) {
      \Drupal::database()->update('bb_track_worklog')
        ->fields(['voided' => 1])
        ->condition('id', $entry->id())
        ->execute();
      \Drupal::entityTypeManager()->getStorage('bb_track_worklog')->resetCache([$entry->id()]);
      $reloaded = Worklog::load($entry->id());
      assert($reloaded instanceof Worklog);
      $entry = $reloaded;
    }
    return $entry;
  }

}
