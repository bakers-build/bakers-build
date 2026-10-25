<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\bb_activity\Activity\EntityDetailActivities;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The activity zone of a project lists its tickets' newest visible events.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ProjectActivitiesTest extends KernelTestBase {

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
    'link', 'text', 'bb_core', 'bb_activity',
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
      'bb_ticket', 'bb_activity', 'bb_notification_setting', 'bb_run', 'bb_comment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    // Activity queries check access. administer bakers bypasses the
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
   * Activities follow the project's tickets and skip other projects.
   */
  public function testActivitiesAreTheProjectsTicketEvents(): void {
    $here = $this->workTicket('Here');
    $here->getState()->applyTransitionById('qualify');
    $here->save();
    $other = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => 'Other', 'key' => 'OTH']);
    $other->save();
    $away = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'title' => 'Away',
        'workflow' => 'bb_work',
        'project_id' => $other->id(),
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $away);
    $away->save();
    $away->getState()->applyTransitionById('qualify');
    $away->save();

    $rows = $this->service()->activities($this->project);
    self::assertNotSame([], $rows);
    foreach ($rows as $activity) {
      $ticket = $activity->get('ticket_id')->entity;
      self::assertInstanceOf(BbTicketInterface::class, $ticket);
      self::assertEquals($this->project->id(), $ticket->get('project_id')->target_id);
    }
  }

  /**
   * The 20-row cap is the newest visible activities of this project.
   */
  public function testActivitiesCapIsTwentyNewestVisibleRows(): void {
    $ids = [];
    for ($i = 0; $i < 24; $i++) {
      $ticket = $this->workTicket('Cap ' . $i);
      $ticket->getState()->applyTransitionById('qualify');
      $ticket->save();
      $ids[] = (int) $ticket->id();
    }

    $rows = $this->service()->activities($this->project);
    self::assertCount(EntityDetailActivities::LIMIT, $rows);
    $ticket_ids = [];
    foreach ($rows as $activity) {
      $ticket_ids[] = (int) $activity->get('ticket_id')->target_id;
    }
    // Each ticket has a created and a status row; newest first.
    $expected = [];
    foreach (array_reverse($ids) as $id) {
      array_push($expected, $id, $id);
    }
    self::assertSame(array_slice($expected, 0, EntityDetailActivities::LIMIT), $ticket_ids);
  }

  /**
   * Newer activities on another project do not fill this project's cap.
   */
  public function testActivitiesCapIgnoresOtherProjectsEvenWhenNewer(): void {
    $visible = [];
    for ($i = 0; $i < 3; $i++) {
      $ticket = $this->workTicket('Visible ' . $i);
      $ticket->getState()->applyTransitionById('qualify');
      $ticket->save();
      $visible[] = (int) $ticket->id();
    }
    $other = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => 'Other cap', 'key' => 'CAP']);
    $other->save();
    for ($i = 0; $i < 21; $i++) {
      $away = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
        ->create([
          'title' => 'Away ' . $i,
          'workflow' => 'bb_work',
          'project_id' => $other->id(),
        ]);
      self::assertInstanceOf(BbTicketInterface::class, $away);
      $away->save();
      $away->getState()->applyTransitionById('qualify');
      $away->save();
    }

    $rows = $this->service()->activities($this->project);
    self::assertCount(6, $rows, 'A created and a status row per visible ticket.');
    $seen = [];
    foreach ($rows as $activity) {
      $seen[] = (int) $activity->get('ticket_id')->target_id;
    }
    sort($seen);
    self::assertSame(array_values(array_unique($seen)), array_values(array_unique($visible)));
  }

  /**
   * The activity list omits rows the viewer may not see.
   */
  public function testActivitiesFollowTicketViewAccess(): void {
    $here = $this->workTicket('Here');
    $here->getState()->applyTransitionById('qualify');
    $here->save();

    self::assertNotSame([], $this->service()->activities($this->project));

    $outsider = $this->createUser([], 'overview-outsider');
    self::assertInstanceOf(UserInterface::class, $outsider);
    $this->setCurrentUser($outsider);
    $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_activity')
      ->resetCache();
    $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_ticket')
      ->resetCache();

    self::assertSame([], $this->service()->activities($this->project));
  }

  /**
   * The detail activities service.
   */
  private function service(): EntityDetailActivities {
    return $this->container->get(EntityDetailActivities::class);
  }

  /**
   * A classified work ticket in qualification.
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

}
