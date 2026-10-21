<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbTerm;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\bb_core\Entity\BbWorkspace;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * The workspace edge on bb_term: present, required, membership-gated.
 *
 * A term was global master data with no tenant edge at all, which is why
 * BB-318 had to exclude it from the read scope: there was no column to filter
 * on. This suite asserts the shape of the edge that closes that gap (D1) and
 * the constraint it reuses (D9).
 *
 * The second case is the load-bearing one. `setRequired(TRUE)` installs a
 * NotNull constraint, NOT a NOT NULL column, and the difference is what makes
 * the migration possible: bb_core_update_8021() installs the column onto a
 * populated table and bb_core_post_update_workspace_term_backfill() fills it
 * afterwards. A NOT NULL column could do neither.
 *
 * @see \Drupal\bb_core\Entity\BbTerm::baseFieldDefinitions()
 * @see \Drupal\bb_core\Plugin\Validation\Constraint\BbWorkspaceScopeConstraint
 */
#[Group('bb_core')]
final class BbTermWorkspaceScopeTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'link', 'text',
    'entity', 'state_machine', 'og', 'bb_core', 'bb_connector',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_term');
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    BbVocabulary::create(['id' => 'bb_labels', 'label' => 'bakers.build labels'])->save();
    // A bundle created after the container booted leaves the typed-data
    // derivative `entity:bb_term:bb_labels` undiscovered, and ->validate()
    // is the caller that needs it — without this the validation cases error on
    // PluginNotFoundException instead of asserting anything.
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    // Uid 1 bypasses every access check, so it must not be an actor.
    $this->createUser();
  }

  /**
   * The field exists, targets bb_workspace, and is required.
   */
  public function testTheFieldIsRequiredAndTargetsTheWorkspace(): void {
    $definitions = \Drupal::service('entity_field.manager')
      ->getBaseFieldDefinitions('bb_term');

    self::assertArrayHasKey('workspace_id', $definitions);
    $field = $definitions['workspace_id'];
    self::assertSame('entity_reference', $field->getType());
    self::assertSame('bb_workspace', $field->getSetting('target_type'));
    self::assertTrue($field->isRequired());
  }

  /**
   * A term with no workspace fails validation — and still saves unvalidated.
   *
   * Both halves matter: the requirement is a NotNull constraint, NOT a NOT NULL
   * column, which is exactly what lets bb_core_update_8021() install the
   * column onto a populated table and the post-update fill it afterwards (D1).
   */
  public function testWorkspacelessTermIsInvalidButStorable(): void {
    $term = BbTerm::create(['vid' => 'bb_labels', 'name' => 'unscoped']);

    self::assertGreaterThan(0, $term->validate()->count());

    $term->save();
    self::assertNotNull(BbTerm::load($term->id()));
  }

  /**
   * The BbWorkspaceScope constraint is bound to the new field.
   */
  public function testTheWorkspaceScopeConstraintIsBound(): void {
    $field = \Drupal::service('entity_field.manager')
      ->getBaseFieldDefinitions('bb_term')['workspace_id'];

    self::assertArrayHasKey('BbWorkspaceScope', $field->getConstraints());
  }

  /**
   * A term bound to a workspace the writer belongs to validates.
   *
   * The actor is a plain member rather than uid 1, because the two rules this
   * case has to clear are both account-sensitive and a bypassing actor would
   * clear them without exercising either: BbWorkspaceScope asks whether the
   * writer belongs to the workspace, and the reference field's own
   * ValidReference asks the selection handler with accessCheck(TRUE), which
   * needs `view bb_workspace`. Asserting the negative half is
   * BbWorkspaceScope's own suite, not this one.
   */
  public function testTermInOwnWorkspaceIsValid(): void {
    $workspace = BbWorkspace::create(['name' => 'w', 'slug' => 'w']);
    $workspace->save();
    $member = $this->createUser(['view bb_workspace']);
    self::assertInstanceOf(UserInterface::class, $member);
    $this->addMembership($workspace, $member, ['member']);
    $this->setCurrentUser($member);

    $term = BbTerm::create([
      'vid' => 'bb_labels',
      'name' => 'scoped',
      'workspace_id' => $workspace->id(),
    ]);

    $violations = $term->validate();
    $seen = [];
    foreach ($violations as $violation) {
      $seen[] = $violation->getPropertyPath() . ': ' . (string) $violation->getMessage();
    }
    self::assertCount(0, $violations, implode(' | ', $seen));
  }

}
