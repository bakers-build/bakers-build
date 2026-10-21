<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Core\Entity\Sql\SqlEntityStorageInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Both directions are navigable, and only one of them is stored (BB-419 D3).
 *
 * THE "NOT A SECOND FIELD" HALF IS ONLY CHECKABLE AGAINST THE STORAGE. A test
 * that asserted the definition alone would stay green with a duplicate stored
 * field sitting beside it, which is precisely the failure the acceptance
 * criterion is worded to catch — BB-315's `sub_tickets` lesson was that a
 * hand-kept inverse drifts, and drift is invisible from the definition side.
 * So the assertion is made twice over: the definition says `isComputed()`, and
 * the table mapping exposes no column for it.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TeamProjectsInverseTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
  }

  /**
   * One fixture, resolved from both ends.
   *
   * The same pair is asserted in both directions rather than in two tests, so
   * a direction that answered about some OTHER pair could not pass.
   */
  public function testBothDirectionsResolveTheSamePair(): void {
    $team = $this->fixture('b', 'bb_team');
    $project = $this->fixture('b', 'bb_project');
    self::assertInstanceOf(BbTeamInterface::class, $team);
    self::assertInstanceOf(BbProjectInterface::class, $project);

    self::assertSame(
      [(string) $team->id()],
      array_map(static fn ($resolved): string => (string) $resolved->id(), $project->getTeams()),
      'the project resolves its team',
    );
    self::assertSame(
      [(string) $project->id()],
      array_map(static fn ($resolved): string => (string) $resolved->id(), $team->getProjects()),
      'the team resolves its project',
    );
  }

  /**
   * A team assigned nothing resolves an empty list, not every project.
   *
   * The negative control. A computed list that ignored its condition would
   * satisfy the test above and would hand every workspace's projects to every
   * team — a tenancy leak that reads as a passing feature.
   */
  public function testTeamWithoutProjectsResolvesNothing(): void {
    $lonely = $this->createEntity('bb_team', [
      'name' => 'unassigned crew',
      'workspace_id' => $this->fixture('b', 'bb_workspace')->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $lonely);

    self::assertSame([], $lonely->getProjects());
  }

  /**
   * The inverse is computed and occupies no column of its own.
   */
  public function testTheInverseIsComputedAndNotStored(): void {
    $definitions = $this->container->get('entity_field.manager')
      ->getBaseFieldDefinitions('bb_team');

    self::assertArrayHasKey('projects', $definitions);
    self::assertTrue(
      $definitions['projects']->isComputed(),
      'bb_team.projects is computed, not a second stored field',
    );

    $entity_type_manager = $this->container->get('entity_type.manager');
    $storage = $entity_type_manager->getStorage('bb_team');
    self::assertInstanceOf(SqlEntityStorageInterface::class, $storage);
    // The base table is the ENTITY TYPE's, not the mapping's:
    // TableMappingInterface promises no getBaseTable(), and reading it there
    // works only by accident of the default implementation.
    $definition = $entity_type_manager->getDefinition('bb_team');
    $base_table = (string) $definition->getBaseTable();
    $mapping = $storage->getTableMapping();
    self::assertNotContains(
      'projects',
      $mapping->getFieldNames($base_table),
      'no base-table column carries the inverse',
    );
    self::assertNotContains(
      $base_table . '__projects',
      $mapping->getTableNames(),
      'and no dedicated table carries it either',
    );
  }

}
