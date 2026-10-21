<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies the computed `base_branch` field on bb_ticket.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BaseBranchFieldTest extends KernelTestBase {

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
   * Creates and saves a bb_project, optionally with one repository delta.
   *
   * @param array<int, array<string, string>> $repository
   *   The single repository item's values, wrapped in a one-element list to
   *   keep callers unchanged.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved project.
   */
  private function project(array $repository = []): ContentEntityInterface {
    $p = $this->container->get('entity_type.manager')->getStorage('bb_project')
      ->create(['name' => 'p'] + ($repository ? ['repository' => $repository] : []));
    assert($p instanceof ContentEntityInterface);
    $p->save();
    return $p;
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
   * A child ticket's base_branch is its parent's branch_name.
   */
  public function testBaseIsParentBranchWhenParentSet(): void {
    $project = $this->project([['url' => 'https://x', 'default_branch' => 'develop']]);
    $parent = $this->ticket(['title' => 'Parent', 'project_id' => $project->id()]);
    $child = $this->ticket([
      'title' => 'Child',
      'project_id' => $project->id(),
      'parent_id' => $parent->id(),
    ]);
    self::assertSame(
      (string) $parent->get('branch_name')->value,
      $child->get('base_branch')->value,
    );
  }

  /**
   * A parentless ticket's base_branch is the project repo default_branch.
   */
  public function testBaseIsProjectDefaultWhenNoParent(): void {
    $project = $this->project([['url' => 'https://x', 'default_branch' => 'develop']]);
    $t = $this->ticket(['title' => 'Top', 'project_id' => $project->id()]);
    self::assertSame('develop', $t->get('base_branch')->value);
  }

  /**
   * The base_branch falls back to 'main' with no repo default_branch.
   */
  public function testBaseIsMainWhenNoRepoDefault(): void {
    $project = $this->project();
    $t = $this->ticket(['title' => 'Top', 'project_id' => $project->id()]);
    self::assertSame('main', $t->get('base_branch')->value);
  }

}
