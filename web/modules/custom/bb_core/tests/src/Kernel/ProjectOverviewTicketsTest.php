<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\ProjectOverviewTickets;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Project Overview stocks: epics.
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
    'field', 'og',
    'link', 'text', 'bb_core',
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
      'bb_ticket', 'bb_run', 'bb_comment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
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
   * Epic tickets of the project, identifier order, skip work tickets.
   */
  public function testEpicTicketsAreTheProjectsEpics(): void {
    $epic = $this->ticket('Epic work', ['workflow' => 'bb_epic']);
    $this->workTicket('Still open');

    $rows = $this->service()->epicTickets($this->project);
    self::assertCount(1, $rows);
    self::assertSame($epic->id(), $rows[0]->id());
  }

  /**
   * The epic list omits tickets the viewer may not see.
   */
  public function testEpicsFollowTicketViewAccess(): void {
    $this->ticket('Epic work', ['workflow' => 'bb_epic']);

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
    return $this->ticket($title, $values + ['workflow' => 'bb_feature']);
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

}
