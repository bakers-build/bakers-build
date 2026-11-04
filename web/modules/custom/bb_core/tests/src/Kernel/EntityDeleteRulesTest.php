<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies what deleting an entity blocks, cascades and detaches.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EntityDeleteRulesTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_project',
      'bb_team', 'bb_environment', 'bb_conductor', 'bb_machine', 'bb_ticket',
      'bb_ticket_template', 'bb_comment', 'bb_run', 'bb_term', 'bb_invite',
    ] as $type) {
      $this->installEntitySchema($type);
    }
  }

  /**
   * Creates and saves an entity.
   *
   * @param string $type
   *   The entity type ID.
   * @param array<string, mixed> $values
   *   The field values.
   */
  private function make(string $type, array $values = []): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')->getStorage($type)->create($values);
    assert($entity instanceof ContentEntityInterface);
    $entity->save();
    return $entity;
  }

  /**
   * Reloads an entity from storage, or NULL once it is gone.
   */
  private function reload(ContentEntityInterface $entity): ?ContentEntityInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage($entity->getEntityTypeId());
    $storage->resetCache([$entity->id()]);
    $loaded = $storage->load($entity->id());
    assert($loaded === NULL || $loaded instanceof ContentEntityInterface);
    return $loaded;
  }

  /**
   * Creates a ticket.
   *
   * @param array<string, mixed> $values
   *   Extra field values.
   */
  private function ticket(array $values = []): ContentEntityInterface {
    return $this->make('bb_ticket', $values + ['title' => 'T', 'workflow' => 'bb_work']);
  }

  /**
   * A ticket takes its comments and runs with it and detaches the rest.
   */
  public function testTicketCascadesCommentsAndRunsAndDetachesTickets(): void {
    $ticket = $this->ticket();
    $comment = $this->make('bb_comment', ['ticket_id' => $ticket->id(), 'body' => ['value' => 'x', 'format' => 'bb_rich']]);
    $run = $this->make('bb_run', ['ticket_id' => $ticket->id()]);
    $child = $this->ticket(['parent_id' => $ticket->id(), 'blocked_by' => [$ticket->id()], 'referenced_tickets' => [$ticket->id()]]);

    $ticket->delete();

    $this->assertNull($this->reload($comment));
    $this->assertNull($this->reload($run));
    $child = $this->reload($child);
    $this->assertNotNull($child);
    $this->assertTrue($child->get('parent_id')->isEmpty());
    $this->assertTrue($child->get('blocked_by')->isEmpty());
    $this->assertTrue($child->get('referenced_tickets')->isEmpty());
  }

  /**
   * Asserts that deleting the entity throws and leaves it in place.
   */
  private function assertBlocked(ContentEntityInterface $entity): void {
    $rules = $this->container->get('bb_core.entity_delete_rules');
    $this->assertNotEmpty($rules->references($entity)['block']);
    try {
      $entity->delete();
      $this->fail('The delete was not blocked.');
    }
    catch (EntityStorageException) {
    }
    $this->assertNotNull($this->reload($entity));
  }

  /**
   * A project with tickets is blocked; an empty one takes its parts with it.
   */
  public function testProjectBlocksOnTicketsAndCascadesItsParts(): void {
    $group = $this->make('bb_group', ['name' => 'G']);
    $project = $this->make('bb_project', ['name' => 'P', 'group_id' => $group->id()]);
    $ticket = $this->ticket(['project_id' => $project->id()]);
    $this->assertBlocked($project);

    $ticket->delete();
    $environment = $this->make('bb_environment', ['name' => 'E', 'project_id' => $project->id()]);
    $template = $this->make('bb_ticket_template', ['name' => 'Tpl', 'project_id' => $project->id()]);
    $project->delete();
    $this->assertNull($this->reload($project));
    $this->assertNull($this->reload($environment));
    $this->assertNull($this->reload($template));
  }

  /**
   * A group a project uses is blocked.
   */
  public function testGroupBlocksWhileAProjectUsesIt(): void {
    $group = $this->make('bb_group', ['name' => 'G']);
    $project = $this->make('bb_project', ['name' => 'P', 'group_id' => $group->id()]);
    $this->assertBlocked($group);
    $project->delete();
    $group->delete();
    $this->assertNull($this->reload($group));
  }

  /**
   * A project's only team is blocked; a shared one is detached.
   */
  public function testTeamBlocksAsOnlyTeamAndDetachesOtherwise(): void {
    $team = $this->make('bb_team', ['name' => 'A']);
    $other = $this->make('bb_team', ['name' => 'B']);
    $sole = $this->make('bb_project', ['name' => 'Sole', 'teams' => [$team->id()]]);
    $this->assertBlocked($team);

    $sole->delete();
    $shared = $this->make('bb_project', ['name' => 'Shared', 'teams' => [$team->id(), $other->id()]]);
    $invite = $this->make('bb_invite', ['team_id' => $team->id(), 'email' => 'a@example.com']);
    $team->delete();
    $shared = $this->reload($shared);
    $this->assertNotNull($shared);
    $this->assertSame([['target_id' => $other->id()]], array_map(fn($v) => ['target_id' => (string) $v['target_id']], $shared->get('teams')->getValue()));
    $this->assertNull($this->reload($invite));
  }

  /**
   * A term in use as type or recipe is blocked; as a label it is detached.
   */
  public function testTermBlocksAsTypeOrRecipeAndDetachesAsLabel(): void {
    foreach (['type', 'recipe', 'label'] as $vid) {
      BbVocabulary::create(['id' => $vid, 'label' => $vid])->save();
    }
    $type = $this->make('bb_term', ['vid' => 'type', 'name' => 'feature']);
    $recipe = $this->make('bb_term', ['vid' => 'recipe', 'name' => 'matt']);
    $label = $this->make('bb_term', ['vid' => 'label', 'name' => 'ui']);
    $typed = $this->ticket(['ticket_type' => $type->id()]);
    $template = $this->make('bb_ticket_template', ['name' => 'Tpl', 'recipe' => $recipe->id()]);
    $labelled = $this->ticket(['labels' => [$label->id()]]);
    $this->assertBlocked($type);
    $this->assertBlocked($recipe);

    $typed->delete();
    $template->delete();
    $type->delete();
    $recipe->delete();
    $label->delete();
    $this->assertNull($this->reload($type));
    $this->assertNull($this->reload($recipe));
    $labelled = $this->reload($labelled);
    $this->assertNotNull($labelled);
    $this->assertTrue($labelled->get('labels')->isEmpty());
  }

  /**
   * An environment is detached from the tickets that name it.
   */
  public function testEnvironmentDetachesFromTickets(): void {
    $environment = $this->make('bb_environment', ['name' => 'E']);
    $ticket = $this->ticket(['environments' => [$environment->id()]]);
    $environment->delete();
    $ticket = $this->reload($ticket);
    $this->assertNotNull($ticket);
    $this->assertTrue($ticket->get('environments')->isEmpty());
  }

  /**
   * A conductor and a machine are detached from what they served.
   */
  public function testConductorAndMachineDetach(): void {
    $machine = $this->make('bb_machine', ['name' => 'M']);
    $conductor = $this->make('bb_conductor', ['label' => 'C', 'machine' => $machine->id()]);
    $ticket = $this->ticket(['conductor_id' => $conductor->id()]);
    // Finished: a detached ticket would cancel an active run first.
    $run = $this->make('bb_run', ['ticket_id' => $ticket->id(), 'conductor_id' => $conductor->id(), 'state' => 'completed']);
    $template = $this->make('bb_ticket_template', ['name' => 'Tpl', 'conductor_id' => $conductor->id()]);

    $machine->delete();
    $conductor = $this->reload($conductor);
    $this->assertNotNull($conductor);
    $this->assertTrue($conductor->get('machine')->isEmpty());

    $conductor->delete();
    foreach ([$ticket, $run, $template] as $referencing) {
      $referencing = $this->reload($referencing);
      $this->assertNotNull($referencing);
      $this->assertTrue($referencing->get('conductor_id')->isEmpty());
    }
  }

  /**
   * A workspace with a group or team is blocked; its own config goes with it.
   */
  public function testWorkspaceBlocksOnStructureAndCascadesItsConfig(): void {
    $workspace = $this->make('bb_workspace', ['name' => 'W', 'slug' => 'w']);
    $group = $this->make('bb_group', ['name' => 'G', 'workspace_id' => $workspace->id()]);
    $team = $this->make('bb_team', ['name' => 'T', 'workspace_id' => $workspace->id()]);
    $this->assertBlocked($workspace);

    $group->delete();
    $team->delete();
    BbVocabulary::create(['id' => 'label', 'label' => 'label'])->save();
    $term = $this->make('bb_term', ['vid' => 'label', 'name' => 'ui', 'workspace_id' => $workspace->id()]);
    $invite = $this->make('bb_invite', ['email' => 'a@example.com', 'workspace_id' => $workspace->id()]);
    $template = $this->make('bb_ticket_template', ['name' => 'Tpl', 'workspace_id' => $workspace->id()]);
    $workspace->delete();
    $this->assertNull($this->reload($workspace));
    $this->assertNull($this->reload($term));
    $this->assertNull($this->reload($invite));
    $this->assertNull($this->reload($template));
  }

}
