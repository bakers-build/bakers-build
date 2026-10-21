<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Lock\DatabaseLockBackend;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_track\Entity\Account;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DependencyInjection\Reference;

/**
 * Every new project gets exactly one active, editable Internal default.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class ProjectBillingProfileTest extends WorkTimeTestBase {

  /**
   * {@inheritdoc}
   *
   * A real lock backend, so a concurrent holder can actually refuse it.
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->register('lock', DatabaseLockBackend::class)
      ->addArgument(new Reference('database'));
  }

  /**
   * A default that cannot be created rolls the whole project creation back.
   */
  public function testProjectCreationRollsBackWhenTheDefaultFails(): void {
    if ($this->container->get('database')->driver() === 'mysql') {
      // WorkTimeMutation uses GET_LOCK there, not the lock service.
      self::markTestSkipped('Holds the lock through the lock service only.');
    }
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_project');
    $concurrent = new DatabaseLockBackend($this->container->get('database'));
    self::assertTrue($concurrent->acquire('bb_track:assignments'));

    try {
      $this->freshProject('Blocked project');
      self::fail('Project creation succeeded while its default could not be created.');
    }
    catch (EntityStorageException $error) {
      self::assertStringContainsString('Refresh and retry', $error->getMessage());
    }
    finally {
      $concurrent->releaseAll();
    }

    self::assertSame([], $storage->loadByProperties(['name' => 'Blocked project']));
    $retried = $this->freshProject('Blocked project');
    self::assertNotNull($this->container->get('bb_track.assignments')->defaultAccount((int) $retried->id()));
  }

  /**
   * UI and non-UI (direct entity storage) creation both get one default.
   */
  public function testProjectCreationCreatesExactlyOneActiveDefault(): void {
    $project = $this->freshProject('Fresh project');
    $assignments = $this->container->get('bb_track.assignments');
    $default = $assignments->defaultAccount((int) $project->id());
    self::assertInstanceOf(Account::class, $default);
    self::assertSame('Fresh project', (string) $default->label());
    self::assertSame('', (string) $default->get('external_id')->value);
    self::assertTrue((bool) $default->get('active')->value);
    self::assertTrue($default->get('tickets')->isEmpty());
    self::assertTrue((bool) $default->get('is_default')->value);
  }

  /**
   * A fresh project, created directly through entity storage (non-UI path).
   */
  private function freshProject(string $name): BbProjectInterface {
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')->create([
      'name' => $name,
      'key' => strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $name), 0, 6)),
      'group_id' => $this->project->get('group_id')->target_id,
      'owner_user_id' => $this->project->get('owner_user_id')->target_id,
    ]);
    $project->save();
    assert($project instanceof BbProjectInterface);
    return $project;
  }

  /**
   * Ordinary saves of an existing project never add a second active default.
   */
  public function testOrdinaryProjectSaveDoesNotDuplicateTheDefault(): void {
    $project = $this->freshProject('Resave project');
    $assignments = $this->container->get('bb_track.assignments');
    $before = $assignments->defaultAccount((int) $project->id());
    $project->set('name', 'Resave project, renamed')->save();
    $after = $assignments->defaultAccount((int) $project->id());
    self::assertSame((int) $before->id(), (int) $after->id());
    self::assertCount(1, array_filter(
      $assignments->accounts((int) $project->id()),
      static fn (Account $account) => (bool) $account->get('is_default')->value,
    ));
  }

  /**
   * Calling the creation operation twice for the same project is idempotent.
   */
  public function testCreateDefaultAccountIsIdempotent(): void {
    $project = $this->freshProject('Idempotent project');
    $assignments = $this->container->get('bb_track.assignments');
    $first = $assignments->defaultAccount((int) $project->id());
    $second = $assignments->createDefaultAccount($project);
    self::assertSame((int) $first->id(), (int) $second->id());
  }

}
