<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Reference\ReferenceOptions;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Kernel tests for the access-checked entity-reference candidate reader.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ReferenceOptionsTest extends KernelTestBase {

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
   * The service under test.
   */
  private ReferenceOptions $options;

  /**
   * The project both the ticket and its candidates belong to.
   */
  private int $projectId;

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
    // Same bypass as ConductorByTicketProjectSelectionTest: reading a
    // reference field's candidates runs an access-checked query through the
    // selection handler, which the workspace read scope also narrows by OG
    // membership since BB-318. `administer bakers` is the documented bypass;
    // this test is about the candidate read, not about read access.
    $this->setUpCurrentUser([], [
      'view bb_conductor', 'view bb_ticket',
      'administer bakers',
    ]);
    $this->options = $this->container->get('bb_core.reference_options');

    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => 'reference-options-project']);
    $project->save();
    $this->projectId = (int) $project->id();

    $this->createConductor('cw-framework', $this->projectId);
  }

  /**
   * The field's access-checked candidates come back as plain-string labels.
   */
  public function testItReturnsTheFieldsAccessCheckedCandidates(): void {
    $ticket = $this->createTicket();
    $options = $this->options->for($ticket, 'conductor_id');
    self::assertSame(['cw-framework'], array_values($options));
  }

  /**
   * A match narrows the candidates on the server (not client-side).
   */
  public function testMatchNarrowsTheCandidatesOnTheServer(): void {
    $ticket = $this->createTicket();
    $this->createTicket(['title' => 'BB-100 sample candidate']);
    self::assertSame([], $this->options->for($ticket, 'parent_id', 'no-such-ticket'));
    self::assertNotSame([], $this->options->for($ticket, 'parent_id', 'BB-'));
  }

  /**
   * AC7's neutrality, asserted on the file rather than argued about.
   */
  public function testItNamesNoEntityTypeOfItsOwn(): void {
    $filename = (new \ReflectionClass(ReferenceOptions::class))->getFileName();
    self::assertIsString($filename);
    $source = file_get_contents($filename);
    self::assertIsString($source);
    self::assertStringNotContainsString('bb_ticket', $source);
  }

  /**
   * Creates an unsaved-then-saved ticket in this test's project.
   *
   * @param array<string, mixed> $values
   *   Extra field values merged over the defaults.
   */
  private function createTicket(array $values = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create($values + [
        'title' => 'Reference options ticket',
        'workflow' => 'bb_work',
        'project_id' => $this->projectId,
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
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
    $owner = $this->createRawUser('owner-' . $machineId);
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
