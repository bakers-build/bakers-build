<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Utility\UpdateException;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\Validation\Constraint\BbWorkspaceSlugConstraint;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the bb_workspace slug constraint at the validation boundary (V1).
 *
 * The slug is the first path segment of every product URL (BB-350 D3), so it
 * has to be URL-safe, unique across the instance, and must not collide with a
 * path segment Drupal or bakers.build already owns. One constraint class
 * enforces all three; this test drives it through entity validation rather than
 * calling the validator directly, because entity validation is the boundary
 * every write actually passes through.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceSlugTest extends KernelTestBase {

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
    foreach (['user', 'og_membership', 'bb_workspace'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
  }

  /**
   * A slug that satisfies the pattern and is unused validates cleanly.
   *
   * @param string $slug
   *   The slug under test.
   */
  #[DataProvider('acceptedSlugs')]
  public function testAcceptedSlug(string $slug): void {
    $workspace = $this->makeWorkspace('Some workspace', $slug);

    self::assertCount(
      0,
      $workspace->validate(),
      sprintf('Slug "%s" should be accepted.', $slug),
    );
  }

  /**
   * Slugs the pattern must reject.
   *
   * @return array<string, array{string}>
   *   Test cases keyed by what makes them invalid.
   */
  public static function acceptedSlugs(): array {
    return [
      'the pinned default' => ['bakers'],
      'a plain word' => ['keytec'],
      'inner hyphens and digits' => ['a-b-2'],
    ];
  }

  /**
   * A slug that violates the pattern is rejected.
   *
   * @param string $slug
   *   The slug under test.
   */
  #[DataProvider('rejectedSlugs')]
  public function testRejectedSlug(string $slug): void {
    $workspace = $this->makeWorkspace('Some workspace', $slug);

    $violations = $workspace->validate();

    self::assertGreaterThan(
      0,
      $violations->count(),
      sprintf('Slug "%s" should be rejected.', $slug),
    );
  }

  /**
   * Slugs the pattern must reject.
   *
   * @return array<string, array{string}>
   *   Test cases keyed by what makes them invalid.
   */
  public static function rejectedSlugs(): array {
    return [
      'uppercase' => ['Foo'],
      'leading hyphen' => ['-x'],
      'trailing hyphen' => ['x-'],
      'inner space' => ['a b'],
      'underscore' => ['a_b'],
      'slash' => ['a/b'],
      'dot' => ['a.b'],
      'empty' => [''],
      'too long' => [str_repeat('a', 65)],
    ];
  }

  /**
   * A slug already taken by another workspace is rejected.
   */
  public function testDuplicateSlugIsRejected(): void {
    $this->makeWorkspace('First', 'shared')->save();

    $second = $this->makeWorkspace('Second', 'shared');

    self::assertGreaterThan(0, $second->validate()->count());
  }

  /**
   * The database refuses a duplicate slug that skipped validation.
   */
  public function testDatabaseRefusesDuplicateSlug(): void {
    $this->makeWorkspace('First', 'shared')->save();

    $this->expectException(EntityStorageException::class);
    $this->makeWorkspace('Second', 'shared')->save();
  }

  /**
   * The update adds the slug key, and refuses while duplicates exist.
   */
  public function testSlugKeyUpdateRefusesDuplicates(): void {
    // The schema as it stood before the key existed.
    $schema = $this->container->get('database')->schema();
    $keyValue = $this->container->get('keyvalue')->get('entity.storage_schema.sql');
    $entitySchema = $keyValue->get('bb_workspace.entity_schema_data');
    unset($entitySchema['bb_workspace']['unique keys']['bb_workspace__slug']);
    $keyValue->set('bb_workspace.entity_schema_data', $entitySchema);
    $schema->dropUniqueKey('bb_workspace', 'bb_workspace__slug');
    $first = $this->makeWorkspace('First', 'shared');
    $first->save();
    $second = $this->makeWorkspace('Second', 'shared');
    $second->save();
    $this->container->get('module_handler')->loadInclude('bb_core', 'install');

    try {
      bb_core_update_11001();
      self::fail('The update must refuse while duplicate slugs exist.');
    }
    catch (UpdateException $expected) {
      self::assertStringContainsString(sprintf('shared: %s, %s', $first->id(), $second->id()), $expected->getMessage());
    }
    self::assertFalse($schema->indexExists('bb_workspace', 'bb_workspace__slug'));
    $unchanged = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->loadUnchanged($second->id());
    self::assertInstanceOf(BbWorkspaceInterface::class, $unchanged);
    self::assertSame('shared', $unchanged->getSlug(), 'Nothing is renamed.');

    $second->delete();
    bb_core_update_11001();
    self::assertTrue($schema->indexExists('bb_workspace', 'bb_workspace__slug'));
  }

  /**
   * Re-saving a workspace does not read its own slug as a duplicate.
   */
  public function testOwnSlugIsNotTreatedAsDuplicate(): void {
    $workspace = $this->makeWorkspace('First', 'mine');
    $workspace->save();

    $workspace->setName('Renamed');

    self::assertCount(0, $workspace->validate());
  }

  /**
   * Every reserved word is rejected as a slug.
   *
   * The reserved list is what keeps a workspace from shadowing a path segment
   * Drupal or bakers.build already owns. ReservedSlugCoverageTest guards the
   * list against the live router; this guards that the list is actually
   * enforced.
   */
  public function testEveryReservedWordIsRejected(): void {
    foreach (BbWorkspaceSlugConstraint::RESERVED as $reserved) {
      $workspace = $this->makeWorkspace('Reserved probe', $reserved);
      self::assertGreaterThan(
        0,
        $workspace->validate()->count(),
        sprintf('Reserved word "%s" should be rejected as a slug.', $reserved),
      );
    }
  }

  /**
   * Builds an unsaved workspace with the given name and slug.
   *
   * @param string $name
   *   The workspace name.
   * @param string $slug
   *   The slug to assign.
   *
   * @return \Drupal\bb_core\Entity\BbWorkspaceInterface
   *   The unsaved workspace.
   */
  private function makeWorkspace(string $name, string $slug): BbWorkspaceInterface {
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => $name, 'slug' => $slug]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    return $workspace;
  }

}
