<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Ticket search with filters and facets counts readable tickets on the index.
 *
 * Fixture: the actor reads P1 and P2, not P3. Conductors: C1 (the actor's,
 * on machine M1) and C3 (another owner's) in P1, C2 (the actor's, no
 * machine) in P2, C4 (the actor's) in P3.
 *
 * Tickets, oldest first: t1 P1/C1 review; t2 P1/C1 plan with a plan; t3
 * P1/C3 review; t4 P2/C2 review; t5 P2/C2 working; t6 P1 without conductor
 * review; t7 P3/C4 review; t8 P1/C1 closed from review, which cancels it; t9
 * P2/C2 working frozen with Question.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketSearchFacetsToolTest extends BakersToolTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter', 'search_api', 'search_api_db',
    'bb_core', 'tool',
  ];

  /**
   * Projects by key: p1, p2, p3.
   *
   * @var array<string, \Drupal\Core\Entity\ContentEntityInterface>
   */
  private array $projects = [];

  /**
   * Conductors by key: c1 to c4.
   *
   * @var array<string, \Drupal\Core\Entity\ContentEntityInterface>
   */
  private array $conductors = [];

  /**
   * Tickets by key: t1 to t9.
   *
   * @var array<string, \Drupal\bb_core\Entity\BbTicketInterface>
   */
  private array $tickets = [];

  /**
   * The machine of C1.
   */
  private ContentEntityInterface $machine;

  /**
   * The owner of C3.
   */
  private ContentEntityInterface $other;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installEntitySchema('bb_machine');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);

    $etm = $this->container->get('entity_type.manager');
    $this->projects['p1'] = $this->project;
    $this->projects['p2'] = $this->createProject('second-project', $this->workspace, TRUE);
    $this->other = $this->account('other', ['skill_user']);
    // Created by someone else: a group's creator becomes its member.
    $this->container->get('current_user')->setAccount($this->other);
    $outside = $etm->getStorage('bb_workspace')->create(['name' => 'outside', 'slug' => 'outside']);
    assert($outside instanceof ContentEntityInterface);
    $outside->save();
    $this->projects['p3'] = $this->createProject('outside-project', $outside, FALSE);
    $this->container->get('current_user')->setAccount($this->actor);

    $machine = $etm->getStorage('bb_machine')->create(['name' => 'm1', 'owner_user_id' => $this->actor->id()]);
    assert($machine instanceof ContentEntityInterface);
    $machine->save();
    $this->machine = $machine;
    $this->conductors['c1'] = $this->createConductor('c1', $this->actor->id(), 'p1', (int) $machine->id());
    $this->conductors['c2'] = $this->createConductor('c2', $this->actor->id(), 'p2');
    $this->conductors['c3'] = $this->createConductor('c3', $this->other->id(), 'p1');
    $this->conductors['c4'] = $this->createConductor('c4', $this->actor->id(), 'p3');

    $this->tickets['t1'] = $this->placed('t1', 'p1', 'c1', 'review');
    $this->tickets['t2'] = $this->placed('t2', 'p1', 'c1', 'plan');
    $etm->getStorage('bb_comment')->create([
      'ticket_id' => $this->tickets['t2']->id(),
      'author' => $this->actor->id(),
      'body' => ['value' => 'The plan', 'format' => 'bb_rich'],
      'type' => 'plan',
    ])->save();
    $this->tickets['t3'] = $this->placed('t3', 'p1', 'c3', 'review');
    $this->tickets['t4'] = $this->placed('t4', 'p2', 'c2', 'review');
    $this->tickets['t5'] = $this->placed('t5', 'p2', 'c2', 'working');
    $this->tickets['t6'] = $this->placed('t6', 'p1', NULL, 'review');
    $this->tickets['t7'] = $this->placed('t7', 'p3', 'c4', 'review');
    $this->tickets['t8'] = $this->placed('t8', 'p1', 'c1', 'review');
    $this->tickets['t8']->set('closed', TRUE)->save();
    $this->tickets['t9'] = $this->placed('t9', 'p2', 'c2', 'working');
    $this->tickets['t9']->set('labels', [$this->term('label', 'Question')->id()])->setFrozen(TRUE)->save();

    $this->container->get('search_api.post_request_indexing')->destruct();
    $this->container->get('bb_core.workspace_read_scope')->reset();
  }

  /**
   * One call answers "Needs me" across projects.
   */
  public function testNeedsMeAcrossProjects(): void {
    $out = $this->search([
      'filters' => [
        'attention' => ['review', 'plan_ready', 'question'],
        'conductor_owner' => 'me',
        'closed' => FALSE,
      ],
      'facets' => ['project', 'attention'],
    ]);
    self::assertSame(['t9', 't4', 't2', 't1'], array_column($out['tickets'], 'title'));
    self::assertSame(4, $out['total']);
    self::assertSame([
      ['value' => $this->projects['p2']->uuid(), 'label' => 'second-project', 'count' => 2],
      ['value' => $this->projects['p1']->uuid(), 'label' => 'tool-project', 'count' => 2],
    ], $out['facets']['project']);
    self::assertSame([
      ['value' => 'review', 'label' => 'Review', 'count' => 2],
      ['value' => 'plan_ready', 'label' => 'Plan ready', 'count' => 1],
      ['value' => 'question', 'label' => 'Question', 'count' => 1],
    ], $out['facets']['attention']);
  }

  /**
   * A conductor bucket names the conductor, its owner and its machine.
   */
  public function testConductorFacetCarriesOwnerAndMachine(): void {
    $out = $this->search(['facets' => ['conductor']]);
    self::assertSame(8, $out['total']);
    self::assertSame([
      $this->conductorBucket('c1', 3, $this->actor, $this->machine),
      $this->conductorBucket('c2', 3, $this->actor, NULL),
      $this->conductorBucket('c3', 1, $this->other, NULL),
    ], $out['facets']['conductor']);
  }

  /**
   * Conductor, state, frozen and closed filters narrow the rows.
   */
  public function testConductorAndStateAndFrozenFilters(): void {
    $titles = fn (array $filters): array => array_column($this->search(['filters' => $filters])['tickets'], 'title');
    self::assertSame(['t9', 't5', 't4'], $titles(['conductor' => [$this->conductors['c2']->uuid()]]));
    self::assertSame(['t3', 't1'], $titles([
      'conductor' => [$this->conductors['c1']->uuid(), $this->conductors['c3']->uuid()],
      'state' => ['review'],
      'closed' => FALSE,
    ]));
    self::assertSame(['t2', 't1'], $titles(['conductor' => [$this->conductors['c1']->uuid()], 'closed' => FALSE]));
    self::assertSame(['t9'], $titles(['frozen' => TRUE]));
    self::assertSame(['t8'], $titles(['closed' => TRUE]));
  }

  /**
   * State buckets carry the workflow's state labels.
   */
  public function testStateFacetUsesWorkflowLabels(): void {
    $labels = TypeWorkflows::ticketStateOptions();
    $out = $this->search(['filters' => ['conductor_owner' => 'me'], 'facets' => ['state']]);
    self::assertSame(6, $out['total']);
    self::assertSame([
      ['value' => 'review', 'label' => $labels['review'], 'count' => 2],
      ['value' => 'working', 'label' => $labels['working'], 'count' => 2],
      ['value' => 'cancelled', 'label' => $labels['cancelled'], 'count' => 1],
      ['value' => 'plan', 'label' => $labels['plan'], 'count' => 1],
    ], $out['facets']['state']);
  }

  /**
   * The project input narrows the rows and the counts.
   */
  public function testProjectInputNarrows(): void {
    $out = $this->search(['project' => $this->projects['p2']->uuid(), 'facets' => ['attention']]);
    self::assertSame(['t9', 't5', 't4'], array_column($out['tickets'], 'title'));
    self::assertSame(3, $out['total']);
    self::assertSame([
      ['value' => 'question', 'label' => 'Question', 'count' => 1],
      ['value' => 'review', 'label' => 'Review', 'count' => 1],
    ], $out['facets']['attention']);
  }

  /**
   * An unreadable ticket is in no row, count or total.
   */
  public function testCountsStayInsideTheReadScope(): void {
    $out = $this->search(['filters' => ['state' => ['review']], 'facets' => ['project', 'conductor']]);
    self::assertSame(['t6', 't4', 't3', 't1'], array_column($out['tickets'], 'title'));
    self::assertSame(4, $out['total']);
    self::assertNotContains($this->projects['p3']->uuid(), array_column($out['facets']['project'], 'value'));
    self::assertNotContains($this->conductors['c4']->uuid(), array_column($out['facets']['conductor'], 'value'));

    $this->container->get('current_user')->setAccount($this->account('nobody', ['skill_user']));
    $out = $this->search(['filters' => ['state' => ['review']], 'facets' => ['project', 'conductor']]);
    self::assertSame([], $out['tickets']);
    self::assertSame(0, $out['total']);
    self::assertSame(['project' => [], 'conductor' => []], $out['facets']);
  }

  /**
   * Bad filters or facets are input errors, never an unfiltered answer.
   */
  public function testRejectsBadFiltersAndFacets(): void {
    $unknown = '00000000-0000-4000-8000-000000000000';
    $cases = [
      [['query' => 'x', 'filters' => ['closed' => FALSE]], ['query', 'filters']],
      [['branch_name' => 'feat/x', 'facets' => ['state']], ['branch_name', 'facets']],
      [['query' => 'x', 'facets' => []], ['query', 'facets']],
      [['branch_name' => 'feat/x', 'filters' => []], ['branch_name', 'filters']],
      [['filters' => ['conductor_owner' => 'you']], ['conductor_owner']],
      [['facets' => ['assignee']], ['assignee']],
      [['filters' => ['conductor' => [$unknown]]], [$unknown]],
      [['filters' => ['conductor' => [$this->conductors['c4']->uuid()]]], [$this->conductors['c4']->uuid()]],
      [['filters' => ['state' => []]], ['state']],
      [['filters' => ['state' => ['nope']]], ['nope']],
      [['filters' => ['attention' => ['bogus']]], ['bogus']],
    ];
    foreach ($cases as [$values, $texts]) {
      $result = $this->runTool('bakers_ticket_search', $values);
      $case = (string) json_encode($values);
      self::assertFalse($result->isSuccess(), $case);
      foreach ($texts as $text) {
        self::assertStringContainsString($text, (string) $result->getMessage(), $case);
      }
    }
  }

  /**
   * Without filters or facets the output is today's.
   */
  public function testWithoutFiltersOutputIsUnchanged(): void {
    $out = $this->search(['query' => 't4']);
    self::assertSame(['t4'], array_column($out['tickets'], 'title'));
    self::assertNull($out['total'] ?? NULL);
    self::assertNull($out['facets'] ?? NULL);
  }

  /**
   * Runs the search tool and returns its outputs.
   *
   * @param array<string, mixed> $values
   *   Tool input.
   *
   * @return array<string, mixed>
   *   Tool output.
   */
  private function search(array $values): array {
    return $this->outputs($this->runTool('bakers_ticket_search', $values));
  }

  /**
   * The expected bucket of a conductor.
   *
   * @return array<string, mixed>
   *   The bucket.
   */
  private function conductorBucket(string $key, int $count, ContentEntityInterface $owner, ?ContentEntityInterface $machine): array {
    return [
      'value' => $this->conductors[$key]->uuid(),
      'label' => $key,
      'count' => $count,
      'owner' => ['uuid' => $owner->uuid(), 'name' => $owner->label()],
      'machine' => $machine ? ['uuid' => $machine->uuid(), 'name' => $machine->label()] : NULL,
    ];
  }

  /**
   * Creates a project with its own group and team in the workspace.
   */
  private function createProject(string $name, ContentEntityInterface $workspace, bool $actorReads): ContentEntityInterface {
    $etm = $this->container->get('entity_type.manager');
    $group = $etm->getStorage('bb_group')->create(['name' => $name . '-group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $etm->getStorage('bb_team')->create(['name' => $name . '-team']);
    assert($team instanceof ContentEntityInterface);
    $team->save();
    $project = $etm->getStorage('bb_project')->create([
      'name' => $name,
      'group_id' => $group->id(),
      'teams' => [$team->id()],
    ]);
    assert($project instanceof ContentEntityInterface);
    $project->save();
    if ($actorReads) {
      $this->addMembership($team, $this->actor);
    }
    return $project;
  }

  /**
   * Creates a conductor of the owner in the project.
   */
  private function createConductor(string $label, int|string $owner, string $project, ?int $machine = NULL): ContentEntityInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $label,
      'label' => $label,
      'owner_user_id' => $owner,
      'status' => 'online',
      'project_id' => $this->projects[$project]->id(),
      'states' => ['plan', 'working', 'review'],
      'machine' => $machine,
    ]);
    assert($conductor instanceof ContentEntityInterface);
    $conductor->save();
    return $conductor;
  }

  /**
   * Creates a ticket in the project on the conductor, moved to the state.
   */
  private function placed(string $title, string $project, ?string $conductor, string $state): BbTicketInterface {
    $ticket = $this->ticket($title, [
      'project_id' => $this->projects[$project]->id(),
      'conductor_id' => $conductor ? $this->conductors[$conductor]->id() : NULL,
    ]);
    $path = [
      'plan' => ['qualify'],
      'working' => ['qualify', 'to_working'],
      'review' => ['qualify', 'to_working', 'to_review'],
    ];
    foreach ($path[$state] as $transition) {
      $ticket->getState()->applyTransitionById($transition);
    }
    $ticket->save();
    return $ticket;
  }

}
