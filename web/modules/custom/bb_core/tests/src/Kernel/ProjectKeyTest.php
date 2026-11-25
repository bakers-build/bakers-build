<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the project `key` and `next_number` fields.
 *
 * `key` is the short, human-facing project prefix (Jira/Linear style) used to
 * build ticket identifiers `KEY-<n>`. It defaults from the project name and is
 * editable in the UI. `next_number` is the monotonic per-project counter.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectKeyTest extends KernelTestBase {

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
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership',
      'bb_group',
      'bb_team',
      'bb_project',
      'bb_environment',
      'bb_conductor',
      'bb_ticket',
      'bb_comment',
      'bb_run',
      'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    // Validating an entity reference runs an access-checked query through the
    // selection handler, so since BB-305 the acting account needs view
    // access to the target type or the reference reads as "cannot be
    // referenced". This test is about the key constraint, not about access.
    $this->setUpCurrentUser([], [
      'view bb_group',
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
   * Creates an unsaved project with the given name, owned by a saved group.
   *
   * The `group_id` reference is required, so the helper attaches a group to
   * keep the returned project valid. Since BB-419 a project also belongs to
   * at least one TEAM, so the helper attaches one of those too — this class is
   * about the `key` field, and a project left teamless would fail its
   * validation assertion for a reason that has nothing to do with keys.
   */
  private function makeProject(string $name): BbProjectInterface {
    $etm = $this->container->get('entity_type.manager');
    $group = $etm->getStorage('bb_group')->create(['name' => 'Test group']);
    $group->save();
    $team = $etm->getStorage('bb_team')->create(['name' => 'Test crew']);
    $team->save();
    $project = $etm->getStorage('bb_project')
      ->create(['name' => $name, 'group_id' => $group->id(), 'teams' => [$team->id()]]);
    $this->assertInstanceOf(BbProjectInterface::class, $project);
    return $project;
  }

  /**
   * The key defaults to the uppercased, alnum-only project name.
   *
   * Project "Web Shop" yields key "WEBSHOP".
   */
  public function testKeyDefaultsFromName(): void {
    $this->assertSame('WEBSHOP', $this->makeProject('Web Shop')->get('key')->value);
  }

  /**
   * A blank name falls back to the BB key.
   */
  public function testKeyFallsBackToBbWhenNameEmpty(): void {
    $this->assertSame('BB', $this->makeProject('')->get('key')->value);
  }

  /**
   * The default key is capped at ten characters.
   */
  public function testKeyCappedAtTenChars(): void {
    $this->assertSame(
      'SUPERCALIF',
      $this->makeProject('Supercalifragilistic')->get('key')->value,
    );
  }

  /**
   * The next_number counter defaults to 1.
   */
  public function testNextNumberDefaultsToOne(): void {
    $this->assertSame(
      1,
      (int) $this->makeProject('Web Shop')->get('next_number')->value,
    );
  }

  /**
   * A well-formed key passes entity validation.
   */
  public function testValidKeyPassesValidation(): void {
    $project = $this->makeProject('Bb');
    $project->set('key', 'BB');
    $this->assertCount(0, $project->validate());
  }

  /**
   * A malformed key (lowercase / bad shape) is rejected by the constraint.
   */
  public function testInvalidKeyFailsValidation(): void {
    $project = $this->makeProject('Bb');
    $project->set('key', 'bb-1');
    $violations = $project->validate();
    $this->assertGreaterThan(0, $violations->count());
  }

  /**
   * Creates and saves a project with the given key.
   */
  private function createProject(string $name, string $key): BbProjectInterface {
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => $name, 'key' => $key]);
    $this->assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Creates one ticket in the project.
   */
  private function createTicket(BbProjectInterface $project): void {
    $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['project_id' => $project->id(), 'workflow' => 'bb_work', 'title' => 'T'])
      ->save();
  }

  /**
   * Returns the key violation messages of a project.
   *
   * @return list<string>
   *   The messages.
   */
  private function keyViolations(BbProjectInterface $project): array {
    $messages = [];
    foreach ($project->validate()->getByField('key') as $violation) {
      $messages[] = strip_tags((string) $violation->getMessage());
    }
    return $messages;
  }

  /**
   * Another project cannot take a prefix that a ticket still carries.
   */
  public function testOldPrefixReservedForOtherProjects(): void {
    $first = $this->createProject('First', 'OLD');
    $this->createTicket($first);
    $first->set('key', 'NEW')->save();

    $second = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => 'Second', 'key' => 'OLD']);
    $this->assertInstanceOf(BbProjectInterface::class, $second);
    $this->assertSame(["The identifier prefix OLD is reserved: another project’s tickets use it."], $this->keyViolations($second));
  }

  /**
   * A project may take back its own old prefix, or keep its current one.
   */
  public function testProjectMayReuseOwnOldPrefix(): void {
    $project = $this->createProject('First', 'OLD');
    $this->createTicket($project);
    $this->assertSame([], $this->keyViolations($project));
    $project->set('key', 'NEW')->save();
    $project->set('key', 'OLD');
    $this->assertSame([], $this->keyViolations($project));
  }

  /**
   * An unchanged prefix is never refused, even when a moved ticket carries it.
   */
  public function testUnchangedPrefixIsNotReserved(): void {
    $first = $this->createProject('First', 'OWN');
    $this->createTicket($first);
    $second = $this->createProject('Second', 'OTHER');
    $ticket = current($this->container->get('entity_type.manager')->getStorage('bb_ticket')->loadByProperties(['identifier' => 'OWN-1']));
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->set('project_id', $second->id())->save();
    $first->set('name', 'First renamed');
    $this->assertSame([], $this->keyViolations($first));
  }

  /**
   * A prefix the current key of another project holds names the value.
   */
  public function testTakenPrefixNamesValue(): void {
    $this->createProject('First', 'TAKEN');
    $second = $this->createProject('Second', 'FREE');
    $second->set('key', 'TAKEN');
    $this->assertSame(['The identifier prefix TAKEN is already used by another project.'], $this->keyViolations($second));
  }

  /**
   * An invalid prefix names the rule.
   */
  public function testInvalidPrefixNamesRule(): void {
    $project = $this->createProject('First', 'FIRST');
    $project->set('key', 'old1');
    $this->assertSame(['The identifier prefix must be 2–10 uppercase letters or digits, starting with a letter (e.g. BB).'], $this->keyViolations($project));
  }

  /**
   * A shorter prefix is free although a longer one starting with it is used.
   */
  public function testLongerPrefixNotReserved(): void {
    $first = $this->createProject('First', 'ABC');
    $this->createTicket($first);
    $first->set('key', 'XYZ')->save();
    $second = $this->createProject('Second', 'FREE');
    $second->set('key', 'AB');
    $this->assertSame([], $this->keyViolations($second));
  }

}
