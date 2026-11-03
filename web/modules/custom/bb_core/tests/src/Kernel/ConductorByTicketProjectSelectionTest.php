<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\EntityReferenceSelection\SelectionInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicket;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Kernel tests for the project-scoped conductor selection handler.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorByTicketProjectSelectionTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'markdown_easy', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->createRawUser('uid1-dummy');
    // Validating an entity reference runs an access-checked query through the
    // selection handler, so since BB-305 the acting account needs view
    // access to the target type or the reference reads as "cannot be
    // referenced". These tests are about the selection handler's project
    // scoping, not about read access.
    $this->setUpCurrentUser([], [
      'view bb_conductor', 'view bb_project', 'view bb_ticket',
      // Plus `administer bakers` since BB-318: the workspace read scope
      // narrows every access-checked collection query to the acting
      // account's OG memberships, and reference validation runs one. The
      // type's admin permission is the documented bypass (D7 guard 2) — the
      // right fix for a test whose subject is not read access, and the
      // alternative to inventing a workspace chain it does not otherwise
      // need. The read scope itself is covered by WorkspaceReadScope*Test.
      'administer bakers',
    ]);
  }

  /**
   * The handler lists only conductors in the ticket's project (AC-2).
   */
  public function testHandlerScopesToTicketProject(): void {
    $p1 = $this->createProject('p1');
    $p2 = $this->createProject('p2');
    $inProject = $this->createConductor('mid-in', $p1);
    $this->createConductor('mid-out', $p2);
    $ticket = BbTicket::create([
      'title' => 'T',
      'workflow' => 'bb_work',
      'project_id' => $p1,
    ]);
    $ticket->save();

    $handler = $this->container->get('plugin.manager.entity_reference_selection')
      ->getInstance([
        'target_type' => 'bb_conductor',
        'handler' => 'bb_conductor_by_ticket_project',
        'entity' => $ticket,
      ]);
    $this->assertInstanceOf(SelectionInterface::class, $handler);
    $referenceable = $handler->getReferenceableEntities();
    $ids = array_map('intval', array_keys($referenceable['bb_conductor'] ?? []));

    $this->assertSame([(int) $inProject->id()], $ids);
  }

  /**
   * Without a ticket context the handler falls open (all conductors).
   */
  public function testHandlerFailsOpenWithoutTicketContext(): void {
    $p1 = $this->createProject('p1');
    $p2 = $this->createProject('p2');
    $this->createConductor('mid-a', $p1);
    $this->createConductor('mid-b', $p2);

    $handler = $this->container->get('plugin.manager.entity_reference_selection')
      ->getInstance([
        'target_type' => 'bb_conductor',
        'handler' => 'bb_conductor_by_ticket_project',
      ]);
    $this->assertInstanceOf(SelectionInterface::class, $handler);
    $referenceable = $handler->getReferenceableEntities();

    $this->assertCount(2, $referenceable['bb_conductor'] ?? []);
  }

  /**
   * An inactive conductor is hidden from project-scoped references.
   */
  public function testInactiveConductorIsNotReferenceable(): void {
    $project = $this->createProject('active-filter');
    $active = $this->createConductor('active', $project);
    $inactive = $this->createConductor('inactive', $project);
    $inactive->set('active', FALSE)->save();
    $ticket = BbTicket::create(['title' => 'T', 'workflow' => 'bb_work', 'project_id' => $project]);
    $ticket->save();
    $handler = $this->container->get('plugin.manager.entity_reference_selection')->getInstance([
      'target_type' => 'bb_conductor',
      'handler' => 'bb_conductor_by_ticket_project',
      'entity' => $ticket,
    ]);
    assert($handler instanceof SelectionInterface);

    $ids = array_keys($handler->getReferenceableEntities()['bb_conductor'] ?? []);
    self::assertContains((int) $active->id(), array_map('intval', $ids));
    self::assertNotContains((int) $inactive->id(), array_map('intval', $ids));
  }

  /**
   * The ticket's current inactive conductor stays referenceable (F5).
   *
   * `OptionsWidgetBase::getSelectedOptions()` keeps a stored value only if it
   * appears in this handler's option list, so a strict `active` filter would
   * make an unrelated save on the web ticket form silently clear a reference
   * decision D1 deliberately strands on a deactivated conductor.
   */
  public function testCurrentlyReferencedInactiveConductorStaysReferenceable(): void {
    $project = $this->createProject('current-exception');
    $current = $this->createConductor('current', $project);
    $other = $this->createConductor('other-inactive', $project);
    $ticket = BbTicket::create([
      'title' => 'T',
      'workflow' => 'bb_work',
      'project_id' => $project,
      'state' => 'working',
    ]);
    $ticket->set('conductor_id', $current->id())->save();
    // A run still in flight is what keeps the deactivation reassigner from
    // clearing this reference (D1) — the only shape in which "the current,
    // now-inactive value" survives to be observed by this handler.
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $current->id(),
      'state' => 'running',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
      'state_at_start' => 'coding',
      'started_at' => $this->container->get('datetime.time')->getRequestTime(),
    ])->save();
    $current->set('active', FALSE)->save();
    $other->set('active', FALSE)->save();
    $ticket = BbTicket::load($ticket->id());
    assert($ticket instanceof BbTicketInterface);
    self::assertSame((int) $current->id(), (int) $ticket->get('conductor_id')->target_id);

    $handler = $this->container->get('plugin.manager.entity_reference_selection')->getInstance([
      'target_type' => 'bb_conductor',
      'handler' => 'bb_conductor_by_ticket_project',
      'entity' => $ticket,
    ]);
    assert($handler instanceof SelectionInterface);

    $ids = array_map('intval', array_keys($handler->getReferenceableEntities()['bb_conductor'] ?? []));
    self::assertContains((int) $current->id(), $ids);
    self::assertNotContains((int) $other->id(), $ids);
  }

  /**
   * A ticket context with no resolvable project offers no candidates (AC-3).
   */
  public function testNewTicketWithoutProjectOffersNoCandidates(): void {
    $p1 = $this->createProject('p1');
    $this->createConductor('mid-a', $p1);
    $ticket = BbTicket::create(['title' => 'T', 'workflow' => 'bb_work']);

    $handler = $this->container->get('plugin.manager.entity_reference_selection')
      ->getInstance([
        'target_type' => 'bb_conductor',
        'handler' => 'bb_conductor_by_ticket_project',
        'entity' => $ticket,
      ]);
    $this->assertInstanceOf(SelectionInterface::class, $handler);
    $referenceable = $handler->getReferenceableEntities();

    $this->assertSame([], $referenceable['bb_conductor'] ?? []);
  }

  /**
   * A stranded reference survives the ticket later moving project (F17).
   *
   * `testCurrentlyReferencedInactiveConductorStaysReferenceable()` keeps the
   * ticket and its current conductor in the same project throughout, so it
   * passes whether the picker's escape sits inside or outside the project
   * condition. This case moves the ticket afterwards, which only fails
   * against the AND-ed placement `f51079886` shipped.
   */
  public function testStrandedConductorSurvivesTicketMovingProject(): void {
    $projectA = $this->createProject('moved-from');
    $projectB = $this->createProject('moved-to');
    $current = $this->createConductor('stranded', $projectA);
    $ticket = BbTicket::create([
      'title' => 'T',
      'workflow' => 'bb_work',
      'project_id' => $projectA,
      'state' => 'working',
    ]);
    $ticket->set('conductor_id', $current->id())->save();
    // A run still in flight keeps the reassigner from clearing the reference
    // (D1) once the conductor is deactivated below.
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $current->id(),
      'state' => 'running',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
      'state_at_start' => 'coding',
      'started_at' => $this->container->get('datetime.time')->getRequestTime(),
    ])->save();
    $current->set('active', FALSE)->save();

    $ticket = BbTicket::load($ticket->id());
    assert($ticket instanceof BbTicketInterface);
    // Moved to a different project afterwards — the stranded reference must
    // still survive, which is exactly the regression F13 fixed.
    $ticket->set('project_id', $projectB)->save();
    $ticket = BbTicket::load($ticket->id());
    assert($ticket instanceof BbTicketInterface);
    self::assertSame((int) $current->id(), (int) $ticket->get('conductor_id')->target_id);

    $handler = $this->container->get('plugin.manager.entity_reference_selection')->getInstance([
      'target_type' => 'bb_conductor',
      'handler' => 'bb_conductor_by_ticket_project',
      'entity' => $ticket,
    ]);
    assert($handler instanceof SelectionInterface);

    $ids = array_map('intval', array_keys($handler->getReferenceableEntities()['bb_conductor'] ?? []));
    self::assertContains((int) $current->id(), $ids);
  }

  /**
   * Creates and saves a BbProject, returning its entity ID.
   */
  private function createProject(string $name): int {
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => $name]);
    $project->save();
    return (int) $project->id();
  }

  /**
   * Creates a plain Drupal user.
   */
  private function createRawUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a BbConductor bound to the given project.
   */
  private function createConductor(string $machineId, int $projectId): BbConductorInterface {
    // An instance admin owner passes BbConductorOwnerAccess, which
    // ConductorOwnerAccessTest covers; this suite is about project scoping.
    $owner = $this->createUser(['administer bakers'], 'owner-' . $machineId);
    $this->assertInstanceOf(UserInterface::class, $owner);
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $machineId,
      'label' => $machineId,
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => $projectId,
      'states' => ['diagnose', 'coding'],
      'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

}
