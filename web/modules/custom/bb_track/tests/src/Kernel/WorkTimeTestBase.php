<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\WorkAssignments;

/**
 * Real entity/access fixtures for the personal time application seam.
 */
abstract class WorkTimeTestBase extends KernelTestBase {

  use OgScopeFixtureTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'file',
    'image',
    'system',
    'user',
    'field',
    'options',
    'text',
    'link',
    'filter',
    'datetime',
    'entity',
    'state_machine',
    'og',
    'serialization',
    'jsonapi',
    'island',
    'bb_core',
    'bb_track',
  ];

  /**
   * Personal time fixture.
   */
  protected UserInterface $employee;
  /**
   * Personal time fixture.
   */
  protected UserInterface $peer;
  /**
   * Personal time fixture.
   */
  protected BbProjectInterface $project;
  /**
   * Personal time fixture.
   */
  protected int $accountId;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user',
      'file',
      'og_membership',
      'bb_workspace',
      'bb_group',
      'bb_team',
      'bb_project',
      'bb_ticket',
      'bb_track_submission', 'bb_track_account',
      'bb_track_worklog',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', [
      'file_usage',
    ]);
    $this->installOgScopeFixture();
    $this->createUser([], 'uid-one');
    $world = $this->createUser([], 'world');
    $employee = $this->createUser([
      'record own worklog',
      'view bb_project',
      'edit bb_project',
      'view bb_ticket',
      'view bb_group',
    ], 'employee');
    $peer = $this->createUser([
      'record own worklog',
      'view bb_project',
      'view bb_ticket',
      'view bb_group',
    ], 'peer');
    assert($world instanceof UserInterface);
    assert($employee instanceof UserInterface);
    assert($peer instanceof UserInterface);
    $this->employee = $employee;
    $this->peer = $peer;
    $types = $this->container->get('entity_type.manager');
    $workspace = $types->getStorage('bb_workspace')->create([
      'name' => 'Week workspace',
      'slug' => 'week',
      'owner_user_id' => $world->id(),
    ]);
    $workspace->save();
    $team = $types->getStorage('bb_team')->create([
      'name' => 'Time crew',
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $world->id(),
    ]);
    $team->save();
    assert($team instanceof ContentEntityInterface);
    $this->addMembership($team, $this->peer);
    $group = $types->getStorage('bb_group')->create([
      'name' => 'Customer',
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $world->id(),
    ]);
    $group->save();
    $project = $types->getStorage('bb_project')->create([
      'name' => 'Work',
      'teams' => [$team->id()],
      'key' => 'WORK',
      'group_id' => $group->id(),
      'owner_user_id' => $world->id(),
    ]);
    assert($project instanceof BbProjectInterface);
    $this->project = $project;
    $this->project->save();
    assert($workspace instanceof ContentEntityInterface);
    $this->addMembership($workspace, $this->employee, [
      'lead',
    ]);
    $this->addMembership($workspace, $this->peer, [
      'contributor',
    ]);
    $this->container->get('current_user')->setAccount($this->employee);
    $assignments = \Drupal::service('bb_track.assignments');
    assert($assignments instanceof WorkAssignments);
    // The project's creation already triggered its automatic Internal
    // default; rename it instead of creating a second active one.
    $default = $assignments->defaultAccount((int) $this->project->id());
    $billing_account = $assignments->saveAccount((int) $this->project->id(), [
      'name' => 'Project work',
    ], $default ? (int) $default->id() : NULL);
    $this->accountId = (int) $billing_account->id();
  }

  /**
   * The fixture workspace.
   */
  protected function fixtureWorkspace(): BbWorkspaceInterface {
    $workspaces = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->loadByProperties(['slug' => 'week']);
    $workspace = reset($workspaces);
    assert($workspace instanceof BbWorkspaceInterface);
    return $workspace;
  }

  /**
   * A known-duration activity with stable source provenance.
   */
  protected function activity(string $key, int $seconds = 7200): array {
    return [
      'source_system' => 'test',
      'source_key' => $key,
      'source_version' => '1',
      'work_date' => '2026-08-03',
      'description' => 'Meeting',
      'project_id' => (int) $this->project->id(),
      'duration_seconds' => $seconds,
    ];
  }

}
