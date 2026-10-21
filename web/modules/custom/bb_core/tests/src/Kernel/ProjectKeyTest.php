<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbProjectInterface;
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
   * A blank name falls back to the bakers.build key.
   */
  public function testKeyFallsBackToBbWhenNameEmpty(): void {
    $this->assertSame('bakers.build', $this->makeProject('')->get('key')->value);
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
    $project->set('key', 'bakers.build');
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

}
