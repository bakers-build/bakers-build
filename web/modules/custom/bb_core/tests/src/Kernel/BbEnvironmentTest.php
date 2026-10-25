<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbEnvironment;
use Drupal\bb_core\Entity\BbEnvironmentInterface;
use Drupal\bb_core\Entity\BbProject;
use Drupal\bb_core\Entity\BbTicket;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Kernel tests for the BbEnvironment entity.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbEnvironmentTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * Modules to enable.
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'file', 'image',
    'field', 'og',
    'bb_core',
    'entity',
    'state_machine',
    'options',
    'text',
    'link',
    'user',
    'system',
    'filter',
    'markdown_easy',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('bb_environment');
    $this->installConfig(['user']);
    // Validating an entity reference runs an access-checked query through the
    // selection handler, so since BB-305 the acting account needs view
    // access to the target type or the reference reads as "cannot be
    // referenced". The tests below are about uniqueness and wiring, not
    // access; the two that assert access set up their own accounts.
    $this->setUpCurrentUser([], [
      'view bb_project', 'view bb_environment',
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
   * Tests creating and loading a BbEnvironment entity.
   */
  public function testCreateAndLoad(): void {
    $project = BbProject::create(['name' => 'acme']);
    $project->save();

    $env = BbEnvironment::create([
      'name' => 'dev2',
      'base_url' => 'https://develop.dev.bakers.build',
      'tier' => 'development',
      'project_id' => $project->id(),
    ]);
    $env->save();

    $loaded = BbEnvironment::load($env->id());
    $this->assertInstanceOf(BbEnvironmentInterface::class, $loaded);
    $this->assertSame('dev2', $loaded->getName());
    $this->assertSame('dev2', $loaded->label());
    $this->assertSame('https://develop.dev.bakers.build', $loaded->getBaseUrl());
    $this->assertSame('development', $loaded->getTier());
    $this->assertSame((int) $project->id(), (int) $loaded->getProject()->id());
  }

  /**
   * Tests the branch field round-trips and defaults to NULL (BB-140).
   */
  public function testBranchField(): void {
    $project = BbProject::create(['name' => 'acme']);
    $project->save();
    $env = BbEnvironment::create([
      'name' => 'prod',
      'base_url' => 'https://app.bakers.build',
      'tier' => 'production',
      'branch' => 'main',
      'project_id' => $project->id(),
    ]);
    $env->save();
    $this->assertSame('main', BbEnvironment::load($env->id())->getBranch());

    $unset = BbEnvironment::create(['name' => 'x', 'project_id' => $project->id()]);
    $unset->save();
    $this->assertNull(BbEnvironment::load($unset->id())->getBranch());
  }

  /**
   * Tests that environment names are unique per project.
   */
  public function testUniquePerProject(): void {
    $a = BbProject::create(['name' => 'project-a']);
    $a->save();
    $b = BbProject::create(['name' => 'project-b']);
    $b->save();

    BbEnvironment::create(['name' => 'dev2', 'project_id' => $a->id()])->save();

    // Same name in the same project → violation.
    $dup = BbEnvironment::create(['name' => 'dev2', 'project_id' => $a->id()]);
    $this->assertGreaterThan(0, $dup->validate()->count());

    // Same name in a different project → allowed.
    $other = BbEnvironment::create(['name' => 'dev2', 'project_id' => $b->id()]);
    $this->assertCount(0, $other->validate());
  }

  /**
   * Tests that a project lists its own environments.
   */
  public function testProjectListsEnvironments(): void {
    $p = BbProject::create(['name' => 'proj']);
    $p->save();
    $q = BbProject::create(['name' => 'other']);
    $q->save();

    $e1 = BbEnvironment::create(['name' => 'dev2', 'project_id' => $p->id()]);
    $e1->save();
    $e2 = BbEnvironment::create(['name' => 'prod', 'project_id' => $p->id()]);
    $e2->save();
    BbEnvironment::create(['name' => 'dev2', 'project_id' => $q->id()])->save();

    $loaded = BbProject::load($p->id());
    $ids = array_map(
      static fn ($item): int => (int) $item['target_id'],
      $loaded->get('environments')->getValue(),
    );
    sort($ids);
    $expected = [(int) $e1->id(), (int) $e2->id()];
    sort($expected);
    $this->assertSame($expected, $ids);
  }

  /**
   * Tests that create access is gated and there is no global add form.
   */
  public function testCreateGatedAndNoGlobalAddForm(): void {
    // Create is permission-gated (used by the project-scoped add route); there
    // is deliberately no global collection or add-form link, so the only way in
    // is the per-project route.
    $handler = \Drupal::entityTypeManager()->getAccessControlHandler('bb_environment');

    $privileged = $this->setUpCurrentUser([], ['create bb_environment']);
    $this->assertTrue($handler->createAccess('bb_environment', $privileged));

    $unprivileged = $this->createUser(['view bb_environment']);
    $this->assertNotFalse($unprivileged);
    $this->assertFalse($handler->createAccess('bb_environment', $unprivileged));

    $definition = \Drupal::entityTypeManager()->getDefinition('bb_environment');
    $this->assertFalse($definition->hasLinkTemplate('collection'));
    $this->assertFalse($definition->hasLinkTemplate('add-form'));
  }

  /**
   * Tests that a ticket can reference an environment.
   */
  public function testTicketReferencesEnvironment(): void {
    // bb_ticket presave queries bb_run — install both schemas.
    $this->installEntitySchema('bb_run');
    $this->installEntitySchema('bb_ticket');

    $project = BbProject::create(['name' => 'acme']);
    $project->save();
    $env = BbEnvironment::create(['name' => 'dev2', 'project_id' => $project->id()]);
    $env->save();

    $ticket = BbTicket::create([
      'title' => 'Deploy something',
      'workflow' => 'bb_work',
      'environments' => [$env->id()],
    ]);
    $ticket->save();

    $loaded = BbTicket::load($ticket->id());
    $this->assertSame((int) $env->id(), (int) $loaded->get('environments')->target_id);
    $this->assertSame('dev2', $loaded->get('environments')->entity->label());
  }

  /**
   * Tests that a ticket can reference multiple environments.
   */
  public function testTicketReferencesMultipleEnvironments(): void {
    // bb_ticket presave queries bb_run — install both schemas.
    $this->installEntitySchema('bb_run');
    $this->installEntitySchema('bb_ticket');

    $project = BbProject::create(['name' => 'acme']);
    $project->save();
    $dev = BbEnvironment::create(['name' => 'dev2', 'project_id' => $project->id()]);
    $dev->save();
    $prod = BbEnvironment::create(['name' => 'prod', 'project_id' => $project->id()]);
    $prod->save();

    $ticket = BbTicket::create([
      'title' => 'Deploy something',
      'workflow' => 'bb_work',
      'environments' => [$dev->id(), $prod->id()],
    ]);
    $ticket->save();

    $loaded = BbTicket::load($ticket->id());
    $labels = array_map(
      static fn ($environment): string => (string) $environment->label(),
      $loaded->get('environments')->referencedEntities(),
    );
    $this->assertSame(['dev2', 'prod'], $labels);
  }

}
