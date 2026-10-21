<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\EnvVars;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the computed `effective_env_vars` field on bb_ticket (BB-99).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EffectiveEnvVarsTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_group', 'bb_project', 'bb_ticket'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
  }

  /**
   * Creates and saves a bb_ticket with the given field values.
   *
   * @param array<string, mixed> $values
   *   Field values to set on the ticket.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved ticket.
   */
  private function ticket(array $values): ContentEntityInterface {
    $t = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['workflow' => 'bb_feature', 'state' => 'todo'] + $values);
    assert($t instanceof ContentEntityInterface);
    $t->save();
    return $t;
  }

  /**
   * Creates and saves a bb_project with the given field values.
   *
   * @param array<string, mixed> $values
   *   Field values to set on the project.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved project.
   */
  private function project(array $values): ContentEntityInterface {
    $group = $this->container->get('entity_type.manager')->getStorage('bb_group')
      ->create(['name' => 'ACME']);
    assert($group instanceof ContentEntityInterface);
    $group->save();
    $p = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => 'P', 'group_id' => $group->id()] + $values);
    assert($p instanceof ContentEntityInterface);
    $p->save();
    return $p;
  }

  /**
   * Creates and saves a bb_ticket belonging to the given project.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $project
   *   The project to attach the ticket to.
   * @param array<string, mixed> $values
   *   Field values to set on the ticket.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved ticket.
   */
  private function ticketFor(ContentEntityInterface $project, array $values = []): ContentEntityInterface {
    return $this->ticket(['project_id' => $project->id()] + $values);
  }

  /**
   * A child inherits the parent's vars; the child wins on a duplicate key.
   */
  public function testChildInheritsAndOverrides(): void {
    $parent = $this->ticket(['title' => 'Parent', 'env_vars' => "A=1\nB=parent"]);
    $child = $this->ticket([
      'title' => 'Child',
      'parent_id' => $parent->id(),
      'env_vars' => "B=child\nC=3",
    ]);
    self::assertSame(
      ['A' => '1', 'B' => 'child', 'C' => '3'],
      EnvVars::parse($child->get('effective_env_vars')->value),
    );
  }

  /**
   * A ticket with no parent resolves to just its own vars.
   */
  public function testRootIsOwnVars(): void {
    $t = $this->ticket(['title' => 'Root', 'env_vars' => "X=9"]);
    self::assertSame(['X' => '9'], EnvVars::parse($t->get('effective_env_vars')->value));
  }

  /**
   * A malformed line in an ancestor is skipped, not carried into the result.
   */
  public function testMalformedAncestorLineSkipped(): void {
    $parent = $this->ticket(['title' => 'Parent', 'env_vars' => "OK=1\nnot valid"]);
    $child = $this->ticket(['title' => 'Child', 'parent_id' => $parent->id()]);
    self::assertSame(['OK' => '1'], EnvVars::parse($child->get('effective_env_vars')->value));
  }

  /**
   * A parent_id cycle (A→B→A) terminates instead of looping forever.
   *
   * The visited-uuid guard in EffectiveEnvVarsItemList must break the walk. If
   * it regressed, resolving effective_env_vars would loop until the test times
   * out; a returned, finite merge proves termination.
   */
  public function testParentCycleTerminates(): void {
    $a = $this->ticket(['title' => 'A', 'env_vars' => "A=1"]);
    $b = $this->ticket(['title' => 'B', 'parent_id' => $a->id(), 'env_vars' => "B=2"]);
    // Close the loop: A's parent is now B.
    $a->set('parent_id', $b->id())->save();

    // Reload so the computed field recomputes against the cyclic graph.
    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')->loadUnchanged($b->id());
    self::assertInstanceOf(ContentEntityInterface::class, $reloaded);
    $resolved = EnvVars::parse($reloaded->get('effective_env_vars')->value);
    // Both vars present (each ticket visited once), and the walk terminated.
    self::assertSame('1', $resolved['A'] ?? NULL);
    self::assertSame('2', $resolved['B'] ?? NULL);
  }

  /**
   * The project supplies a default the ticket overrides.
   */
  public function testProjectSuppliesDefaultsTheTicketOverrides(): void {
    $project = $this->project(['env_vars' => "SHARED=from-project\nONLY_PROJECT=1"]);
    $ticket = $this->ticketFor($project, ['title' => 'T', 'env_vars' => 'SHARED=from-ticket']);

    self::assertSame(
      ['SHARED' => 'from-ticket', 'ONLY_PROJECT' => '1'],
      EnvVars::parse($ticket->get('effective_env_vars')->value),
    );
  }

  /**
   * An ancestor overrides the project, and the ticket overrides both.
   */
  public function testAnAncestorOverridesTheProjectAndTheTicketOverridesBoth(): void {
    $project = $this->project(['env_vars' => 'K=project']);
    $root = $this->ticketFor($project, ['title' => 'Root', 'env_vars' => 'K=root']);
    $child = $this->ticketFor($project, ['title' => 'Child', 'env_vars' => 'K=child', 'parent_id' => $root->id()]);

    self::assertSame(['K' => 'child'], EnvVars::parse($child->get('effective_env_vars')->value));
  }

  /**
   * A ticket whose project alone carries values resolves to just those.
   */
  public function testProjectOnlyResolvesToItself(): void {
    $ticket = $this->ticketFor($this->project(['env_vars' => 'ONLY=1']), ['title' => 'T']);
    self::assertSame(['ONLY' => '1'], EnvVars::parse($ticket->get('effective_env_vars')->value));
  }

  /**
   * A project with no env_vars contributes nothing.
   */
  public function testAnEmptyProjectContributesNothing(): void {
    $ticket = $this->ticketFor($this->project([]), ['title' => 'T', 'env_vars' => 'T=1']);
    self::assertSame(['T' => '1'], EnvVars::parse($ticket->get('effective_env_vars')->value));
  }

  /**
   * A fresh read follows a project change rather than a stale computed value.
   */
  public function testFreshReadFollowsProjectChange(): void {
    $project = $this->project(['env_vars' => 'K=before']);
    $ticket = $this->ticketFor($project, ['title' => 'T']);
    self::assertSame(['K' => 'before'], EnvVars::parse($ticket->get('effective_env_vars')->value));

    $project->set('env_vars', 'K=after')->save();

    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    self::assertInstanceOf(ContentEntityInterface::class, $reloaded);
    self::assertSame(['K' => 'after'], EnvVars::parse($reloaded->get('effective_env_vars')->value));
  }

}
