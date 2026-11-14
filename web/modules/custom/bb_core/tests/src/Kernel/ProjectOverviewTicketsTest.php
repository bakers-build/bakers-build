<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTerm;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\bb_core\Ticket\ProjectOverviewTickets;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Project Overview stocks: epics, their progress and whether tickets exist.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectOverviewTicketsTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'filter',
    'link', 'text', 'search_api', 'search_api_db', 'bb_core',
  ];

  /**
   * The project under test.
   */
  private BbProjectInterface $project;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_run', 'bb_comment', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    BbVocabulary::create(['id' => 'type', 'label' => 'type'])->save();
    // Epic queries check access. administer bakers bypasses the
    // workspace read-scope narrowing so these tests measure stocks, not
    // tenancy. The access test below switches to an outsider.
    $this->setUpCurrentUser(['uid' => 1], ['administer bakers']);
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => 'Overview project', 'key' => 'OVW']);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;
  }

  /**
   * Tickets of type epic, identifier order, skip other types.
   */
  public function testEpicTicketsAreTheProjectsEpics(): void {
    $epic = $this->workTicket('Epic work', ['ticket_type' => $this->type('epic')]);
    $this->workTicket('Feature work', ['ticket_type' => $this->type('feature')]);
    $this->workTicket('Still open');

    $rows = $this->service()->epicTickets($this->project);
    self::assertCount(1, $rows);
    self::assertSame($epic->id(), $rows[0]->id());
  }

  /**
   * The epic list omits tickets the viewer may not see.
   */
  public function testEpicsFollowTicketViewAccess(): void {
    $this->workTicket('Epic work', ['ticket_type' => $this->type('epic')]);

    self::assertCount(1, $this->service()->epicTickets($this->project));

    $outsider = $this->createUser([], 'overview-outsider');
    self::assertInstanceOf(UserInterface::class, $outsider);
    $this->setCurrentUser($outsider);
    $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_ticket')
      ->resetCache();

    self::assertSame([], $this->service()->epicTickets($this->project));
  }

  /**
   * Epic progress counts direct children by the Board's work state.
   *
   * Done is `done`, in progress `working`, open `not_assigned` plus `intake`;
   * a grandchild belongs to its own parent, not the epic.
   */
  public function testEpicProgressCountsDirectChildrenByWorkState(): void {
    $this->installIndex();
    $conductor = $this->conductor();
    $epic = $this->workTicket('Epic', ['ticket_type' => $this->type('epic')]);
    $empty = $this->workTicket('Empty epic', ['ticket_type' => $this->type('epic')]);
    $this->workTicket('Done one', ['parent_id' => $epic->id(), 'closed' => TRUE]);
    $this->workTicket('Done two', ['parent_id' => $epic->id(), 'closed' => TRUE]);
    $working = $this->workTicket('Working', [
      'parent_id' => $epic->id(),
      'conductor_id' => $conductor,
      'state' => 'plan',
    ]);
    $this->workTicket('Intake', ['parent_id' => $epic->id(), 'conductor_id' => $conductor]);
    $this->workTicket('Not assigned', ['parent_id' => $epic->id()]);
    $this->workTicket('Grandchild', ['parent_id' => $working->id(), 'closed' => TRUE]);
    $this->indexTickets();

    self::assertSame([
      (int) $epic->id() => ['done' => 2, 'in_progress' => 1, 'open' => 2, 'total' => 5],
      (int) $empty->id() => ['done' => 0, 'in_progress' => 0, 'open' => 0, 'total' => 0],
    ], $this->service()->epicProgress([$epic, $empty]));
    self::assertSame([], $this->service()->epicProgress([]));
  }

  /**
   * Epic progress counts only the children the viewer may view.
   */
  public function testEpicProgressFollowsTicketViewAccess(): void {
    $this->installIndex();
    $epic = $this->workTicket('Epic', ['ticket_type' => $this->type('epic')]);
    $this->workTicket('Child', ['parent_id' => $epic->id()]);
    $this->indexTickets();

    $outsider = $this->createUser([], 'progress-outsider');
    self::assertInstanceOf(UserInterface::class, $outsider);
    $this->setCurrentUser($outsider);

    self::assertSame(
      [(int) $epic->id() => ['done' => 0, 'in_progress' => 0, 'open' => 0, 'total' => 0]],
      $this->service()->epicProgress([$epic]),
    );
  }

  /**
   * A project has tickets only when the viewer may view one of them.
   */
  public function testHasTicketsFollowsTicketViewAccess(): void {
    self::assertFalse($this->service()->hasTickets($this->project));
    $this->workTicket('Visible');
    self::assertTrue($this->service()->hasTickets($this->project));

    $outsider = $this->createUser([], 'tickets-outsider');
    self::assertInstanceOf(UserInterface::class, $outsider);
    $this->setCurrentUser($outsider);
    $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_ticket')
      ->resetCache();

    self::assertFalse($this->service()->hasTickets($this->project));
  }

  /**
   * The Overview stocks service.
   */
  private function service(): ProjectOverviewTickets {
    return $this->container->get(ProjectOverviewTickets::class);
  }

  /**
   * A classified feature ticket in qualification.
   *
   * @param string $title
   *   Ticket title.
   * @param array<string, mixed> $values
   *   Extra field values.
   */
  private function workTicket(string $title, array $values = []): BbTicketInterface {
    return $this->ticket($title, $values + ['workflow' => 'bb_work']);
  }

  /**
   * A saved ticket on the fixture project.
   *
   * @param string $title
   *   Ticket title.
   * @param array<string, mixed> $values
   *   Field values.
   */
  private function ticket(string $title, array $values): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create($values + [
        'title' => $title,
        'project_id' => $this->project->id(),
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * The id of a conductor of the fixture project.
   */
  private function conductor(): int|string|null {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => 'progress-conductor',
      'label' => 'progress-conductor',
      'owner_user_id' => 1,
      'status' => 'online',
      'project_id' => $this->project->id(),
      'states' => ['plan'],
    ]);
    $conductor->save();
    return $conductor->id();
  }

  /**
   * Installs the ticket index, so saved tickets are tracked.
   */
  private function installIndex(): void {
    $this->installEntitySchema('search_api_task');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')->installOptionalConfig(NULL, ['module' => 'bb_core']);
  }

  /**
   * Indexes the tracked tickets.
   */
  private function indexTickets(): void {
    $this->container->get('entity_type.manager')->getStorage('search_api_index')->load('bb_tickets')->indexItems();
  }

  /**
   * The id of a new type term.
   */
  private function type(string $name): int|string|null {
    $term = BbTerm::create(['vid' => 'type', 'name' => $name]);
    $term->save();
    return $term->id();
  }

}
