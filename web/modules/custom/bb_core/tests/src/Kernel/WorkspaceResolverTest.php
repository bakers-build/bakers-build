<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the per-type workspace resolution chains (V3, BB-350 D7).
 *
 * Every workspace-owned type reaches its workspace over a declared chain of
 * entity references, walked hop by hop. Two properties matter and neither is
 * visible from a single happy-path assertion, which is why this is a kernel
 * test rather than a unit test: the chains have to match the real base-field
 * names of the real entity types, and a chain with an empty hop has to answer
 * NULL rather than throw. A production ticket without a project, or a project
 * without a group, is expressible today — no base field in the chain is
 * NOT NULL — so the broken-chain case is reachable data, not a hypothetical.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceResolverTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * The resolver under test.
   */
  private WorkspaceResolverInterface $resolver;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_environment', 'bb_run',
      'bb_comment', 'bb_conductor', 'bb_machine',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $resolver = $this->container->get('bb_core.workspace_resolver');
    self::assertInstanceOf(WorkspaceResolverInterface::class, $resolver);
    $this->resolver = $resolver;
  }

  /**
   * Each of the workspace-owned types resolves to its own workspace.
   */
  public function testEveryChainReachesTheWorkspace(): void {
    $workspace = $this->create('bb_workspace', ['name' => 'Acme', 'slug' => 'acme']);
    $group = $this->create('bb_group', ['name' => 'Acme group', 'workspace_id' => $workspace->id()]);
    $team = $this->create('bb_team', ['name' => 'Acme team', 'workspace_id' => $workspace->id()]);
    $project = $this->create('bb_project', [
      'name' => 'Acme project',
      'key' => 'ACME',
      'group_id' => $group->id(),
    ]);
    $ticket = $this->create('bb_ticket', [
      'title' => 'A ticket',
      'project_id' => $project->id(),
    ]);
    $environment = $this->create('bb_environment', [
      'name' => 'staging',
      'project_id' => $project->id(),
    ]);
    $run = $this->create('bb_run', ['ticket_id' => $ticket->id()]);
    $comment = $this->create('bb_comment', [
      'ticket_id' => $ticket->id(),
      'body' => 'hello',
    ]);
    $conductor = $this->create('bb_conductor', [
      'label' => 'Acme conductor',
      'project_id' => $project->id(),
    ]);
    foreach ([
      'bb_group' => $group,
      'bb_team' => $team,
      'bb_project' => $project,
      'bb_ticket' => $ticket,
      'bb_environment' => $environment,
      'bb_run' => $run,
      'bb_comment' => $comment,
      'bb_conductor' => $conductor,
    ] as $label => $entity) {
      $resolved = $this->resolver->resolve($entity);
      self::assertInstanceOf(
        BbWorkspaceInterface::class,
        $resolved,
        sprintf('%s must resolve to a workspace.', $label),
      );
      self::assertSame(
        (int) $workspace->id(),
        (int) $resolved->id(),
        sprintf('%s must resolve to the workspace at the end of its chain.', $label),
      );
    }
  }

  /**
   * A chain with an empty hop answers NULL instead of throwing.
   *
   * One case per hop position, so a resolver that only guards the first hop
   * fails here rather than in production on the first projectless ticket.
   */
  public function testEveryPartialChainResolvesToNull(): void {
    $orphan_group = $this->create('bb_group', ['name' => 'No workspace']);
    $orphan_project = $this->create('bb_project', ['name' => 'No group', 'key' => 'NOGRP']);
    $grouped_project = $this->create('bb_project', [
      'name' => 'Groupless chain',
      'key' => 'ORPH',
      'group_id' => $orphan_group->id(),
    ]);
    $orphan_ticket = $this->create('bb_ticket', ['title' => 'No project']);
    $ticket_on_orphan_project = $this->create('bb_ticket', [
      'title' => 'Project without group',
      'project_id' => $orphan_project->id(),
    ]);
    $ticket_on_groupless_chain = $this->create('bb_ticket', [
      'title' => 'Group without workspace',
      'project_id' => $grouped_project->id(),
    ]);

    $cases = [
      'group without workspace' => $orphan_group,
      'team without workspace' => $this->create('bb_team', ['name' => 'No workspace']),
      'project without group' => $orphan_project,
      'project whose group has no workspace' => $grouped_project,
      'ticket without project' => $orphan_ticket,
      'ticket whose project has no group' => $ticket_on_orphan_project,
      'ticket whose group has no workspace' => $ticket_on_groupless_chain,
      'environment without project' => $this->create('bb_environment', ['name' => 'nowhere']),
      'run without ticket' => $this->create('bb_run', []),
      'run whose ticket has no project' => $this->create('bb_run', ['ticket_id' => $orphan_ticket->id()]),
      'comment without ticket' => $this->create('bb_comment', ['body' => 'orphan']),
      'comment whose ticket has no project' => $this->create('bb_comment', [
        'ticket_id' => $orphan_ticket->id(),
        'body' => 'orphan chain',
      ]),
      'conductor without project' => $this->create('bb_conductor', [
        'label' => 'reg-no-project',
      ]),
      'conductor whose project has no group' => $this->create('bb_conductor', [
        'label' => 'reg-no-group',
        'project_id' => $orphan_project->id(),
      ]),
      'conductor whose group has no workspace' => $this->create('bb_conductor', [
        'label' => 'reg-no-workspace',
        'project_id' => $grouped_project->id(),
      ]),
    ];

    foreach ($cases as $label => $entity) {
      self::assertNull(
        $this->resolver->resolve($entity),
        sprintf('A %s must resolve to NULL.', $label),
      );
    }
  }

  /**
   * A type with no declared chain resolves to NULL rather than guessing.
   *
   * Types whose product routes stay entirely administrative have no chain.
   *
   * `bb_workspace` cannot be addressed inside itself. `bb_machine` product
   * View and Edit live in the user area, so they carry no workspace segment.
   * `bb_conductor` used to sit in this set while its canonical stayed at
   * `/admin/bakers`; its product Overview now walks
   * `project_id → group_id → workspace_id`.
   */
  public function testUndeclaredTypesResolveToNull(): void {
    $workspace = $this->create('bb_workspace', ['name' => 'Acme', 'slug' => 'acme']);
    $machine = $this->create('bb_machine', [
      'name' => 'Acme host',
    ]);

    self::assertNull($this->resolver->resolve($workspace));
    self::assertNull($this->resolver->resolve($machine));
    self::assertFalse($this->resolver->hasChain('bb_workspace'));
    self::assertFalse($this->resolver->hasChain('user'));
    self::assertFalse($this->resolver->hasChain('bb_machine'));
    self::assertTrue($this->resolver->hasChain('bb_ticket'));
    self::assertTrue($this->resolver->hasChain('bb_conductor'));
  }

  /**
   * Creates and saves an entity of the given type.
   *
   * @param string $entity_type_id
   *   The entity type to create.
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved entity.
   */
  private function create(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

}
