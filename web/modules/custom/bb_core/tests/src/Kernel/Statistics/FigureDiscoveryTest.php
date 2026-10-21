<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbMeasurement;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\FigureDiscovery;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\user\Entity\Role;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers Condition-based figure selection for exact route context shapes.
 */
#[Group('bb_core')]
final class FigureDiscoveryTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine', 'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team', 'bb_project'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    BbMeasurement::create([
      'id' => 'closed_tickets',
      'label' => 'Closed tickets',
      'value_type' => 'integer',
      'unit' => 'tickets',
      'source' => ['entity_type' => 'user', 'time_field' => 'created'],
      'operation' => ['type' => 'count'],
    ])->save();
    $this->figure('project_only', ['project']);
    $this->figure('user_only', ['user']);
    $this->figure('team_only', ['team']);
    $this->figure('team_user', ['team', 'user']);
    $this->figure('and_failure', ['project', 'user'], ['user' => 'bb_team']);
    $role = Role::create([
      'id' => 'figure_viewer',
      'label' => 'Figure viewer',
    ]);
    foreach (['project_only', 'user_only', 'team_only', 'team_user', 'and_failure'] as $figure_id) {
      $role->grantPermission('view bakers figure ' . $figure_id);
    }
    $role->save();
  }

  /**
   * Project, user, team, and combined contexts select distinct figures.
   */
  public function testDiscoverySelectsOnlyTheExactContextShape(): void {
    $workspace = $this->workspace('scope');
    $project = $this->project('scope');
    $team = $this->team('scope', $workspace);
    $user = $this->accountEntity('scope-user');
    $this->addMembership($team, $user);
    $account = $this->allowedAccount();

    self::assertSame(['project_only'], $this->ids($this->discovery()->discover(['project' => $project], $account)));
    self::assertSame(['user_only'], $this->ids($this->discovery()->discover(
      ['user' => $user],
      $this->allowedAccount((int) $user->id()),
    )));
    self::assertSame(['team_only'], $this->ids($this->discovery()->discover(['team' => $team], $account)));
    self::assertSame(['team_user'], $this->ids($this->discovery()->discover(['team' => $team, 'user' => $user], $account)));
  }

  /**
   * Missing and surplus contexts fail closed instead of inheriting figures.
   */
  public function testMissingAndSurplusContextsFailClosed(): void {
    $workspace = $this->workspace('nested');
    $team = $this->team('nested', $workspace);
    $user = $this->accountEntity('nested-user');
    $this->addMembership($team, $user);
    $account = $this->allowedAccount();

    self::assertSame(['team_only'], $this->ids($this->discovery()->discover(['team' => $team], $account)));
    self::assertSame(['team_user'], $this->ids($this->discovery()->discover(['team' => $team, 'user' => $user], $account)));
    self::assertSame([], $this->ids($this->discovery()->discover(
      ['team' => $team, 'user' => $user, 'workspace' => $workspace],
      $account,
    )));
  }

  /**
   * Every configured Condition must pass.
   */
  public function testConditionsUseAndSemantics(): void {
    $project = $this->project('and');
    $user = $this->accountEntity('and-user');

    self::assertSame([], $this->ids($this->discovery()->discover(
      ['project' => $project, 'user' => $user],
      $this->allowedAccount(),
    )));
  }

  /**
   * A caller without the figure permission discovers nothing.
   */
  public function testPermissionDenialOmitsTheFigure(): void {
    self::assertSame([], $this->discovery()->discover(
      ['user' => $this->accountEntity('target')],
      $this->deniedAccount(),
    ));
  }

  /**
   * A self user without the generated permission discovers no user figure.
   */
  public function testSelfContextDoesNotBypassFigurePermission(): void {
    $self = $this->accountEntity('self-without-figure-permission');

    self::assertSame([], $this->discovery()->discover(
      ['user' => $self],
      $this->deniedAccount((int) $self->id()),
    ));
  }

  /**
   * A team-user figure cannot probe a user outside the selected team.
   */
  public function testCombinedContextRequiresTargetMembership(): void {
    $workspace = $this->workspace('membership');
    $team = $this->team('membership', $workspace);
    $target = $this->accountEntity('membership-target');
    $contexts = ['team' => $team, 'user' => $target];

    self::assertSame([], $this->ids($this->discovery()->discover($contexts, $this->allowedAccount())));
    $this->addMembership($team, $target);
    self::assertSame(['team_user'], $this->ids($this->discovery()->discover($contexts, $this->allowedAccount())));
  }

  /**
   * Gets the figure discovery service.
   */
  private function discovery(): FigureDiscovery {
    $service = $this->container->get('bb_core.figure_discovery');
    self::assertInstanceOf(FigureDiscovery::class, $service);
    return $service;
  }

  /**
   * Creates one figure for a configured context shape.
   *
   * @param string $id
   *   The figure ID.
   * @param array<string> $shape
   *   The exact context keys.
   * @param array<string, string> $entityTypeOverrides
   *   Optional entity type overrides keyed by context name.
   */
  private function figure(string $id, array $shape, array $entityTypeOverrides = []): void {
    $conditions = [];
    foreach ($shape as $key) {
      $conditions[$key] = [
        'id' => 'bb_route_context',
        'entity_type' => $entityTypeOverrides[$key] ?? match ($key) {
          'project' => 'bb_project',
          'team' => 'bb_team',
          'user' => 'user',
          'workspace' => 'bb_workspace',
          default => throw new \InvalidArgumentException('Unsupported context key.'),
        },
        'negate' => FALSE,
        'context_mapping' => ['entity' => $key],
      ];
    }
    BbFigure::create([
      'id' => $id,
      'label' => $id,
      'weight' => 0,
      'widget' => 'matrix',
      'measurements' => ['closed_tickets'],
      'categories' => ['type' => 'windows', 'values' => ['day', 'week', 'month']],
      'filters' => [],
      'context_shape' => $shape,
      'conditions' => $conditions,
    ])->save();
  }

  /**
   * Creates an account with the figure permission.
   */
  private function allowedAccount(int $id = 99): AccountInterface {
    $account = $this->createMock(AccountInterface::class);
    $account->method('hasPermission')->willReturn(TRUE);
    $account->method('getRoles')->willReturn(['figure_viewer']);
    $account->method('id')->willReturn($id);
    return $account;
  }

  /**
   * Creates an account without the figure permission.
   */
  private function deniedAccount(int $id = 99): AccountInterface {
    $account = $this->createMock(AccountInterface::class);
    $account->method('hasPermission')->willReturn(FALSE);
    $account->method('getRoles')->willReturn([]);
    $account->method('id')->willReturn($id);
    return $account;
  }

  /**
   * Extracts figure IDs.
   *
   * @param array<\Drupal\bb_core\BbFigureInterface> $figures
   *   The figures.
   *
   * @return array<string>
   *   The figure IDs.
   */
  private function ids(array $figures): array {
    return array_map(static fn($figure): string => (string) $figure->id(), $figures);
  }

  /**
   * Creates and saves a workspace.
   */
  private function workspace(string $name): BbWorkspaceInterface {
    $entity = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create(['name' => $name]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Creates and saves a team.
   */
  private function team(string $name, BbWorkspaceInterface $workspace): BbTeamInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => $name, 'workspace_id' => $workspace->id()]);
    self::assertInstanceOf(BbTeamInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Creates and saves a project.
   */
  private function project(string $name): BbProjectInterface {
    $entity = $this->container->get('entity_type.manager')->getStorage('bb_project')->create(['name' => $name]);
    self::assertInstanceOf(BbProjectInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Creates and saves a user account entity.
   */
  private function accountEntity(string $name): UserInterface {
    $entity = $this->container->get('entity_type.manager')->getStorage('user')->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $entity);
    $entity->save();
    return $entity;
  }

}
