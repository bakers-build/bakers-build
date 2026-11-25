<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the identifier prefix (`key`) rules of a project.
 *
 * A prefix that another project's tickets carry stays reserved, so ticket
 * identifiers never collide after a project changes its prefix.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectKeyTest extends KernelTestBase {

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
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_environment',
      'bb_conductor', 'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
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
