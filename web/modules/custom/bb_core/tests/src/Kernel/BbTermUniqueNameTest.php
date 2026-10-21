<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTerm;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\bb_core\Entity\BbWorkspace;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * A term name is unique within (workspace_id, vid) and nowhere wider.
 *
 * A validation constraint fires on ->validate(), and a kernel test is the only
 * place that calls it directly and can read the violation's propertyPath. The
 * `codex` case is a regression guard against a reviewer narrowing the key to
 * (workspace_id, name), which would fail on live data (D5).
 *
 * The actor is a plain member of every workspace this suite builds, not uid 1.
 * A bypassing actor would clear BbWorkspaceScope and the reference field's
 * own ValidReference without exercising either, and the exact violation counts
 * these cases assert would then be measuring the bypass rather than the
 * uniqueness rule.
 *
 * @see \Drupal\bb_core\Plugin\Validation\Constraint\BbTermUniqueNameInWorkspaceConstraint
 */
#[Group('bb_core')]
final class BbTermUniqueNameTest extends KernelTestBase {

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
   * The account every case acts as — a member of every workspace it builds.
   */
  private UserInterface $actor;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_term');
    // The workspace read scope resolves an account's projects and teams on
    // every scoped read (BbWorkspaceReadScope::projectsOfWorkspaces() joins
    // bb_project through bb_group.workspace_id, and teamsOfWorkspaces()
    // queries bb_team), so their tables have to exist even though no case
    // below creates one. Without them a scoped read dies on "Base table ...
    // doesn't exist" instead of asserting anything.
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('bb_team');
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    BbVocabulary::create(['id' => 'bb_labels', 'label' => 'bakers.build labels'])->save();
    BbVocabulary::create([
      'id' => 'bb_capability_tags',
      'label' => 'bakers.build capability tags',
    ])->save();
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    // Uid 1 bypasses every access check, so it must not be the actor.
    $this->createUser();
    $actor = $this->createUser(['view bb_workspace']);
    self::assertInstanceOf(UserInterface::class, $actor);
    $this->actor = $actor;
    $this->setCurrentUser($this->actor);
  }

  /**
   * Creates and saves a workspace the actor belongs to.
   */
  private function workspace(string $slug): BbWorkspaceInterface {
    $workspace = BbWorkspace::create(['name' => $slug, 'slug' => $slug]);
    $workspace->save();
    $this->addMembership($workspace, $this->actor, ['member']);
    return $workspace;
  }

  /**
   * Creates and saves a term.
   */
  private function term(BbWorkspaceInterface $workspace, string $vid, string $name): BbTerm {
    $term = BbTerm::create([
      'vid' => $vid,
      'name' => $name,
      'workspace_id' => $workspace->id(),
    ]);
    $term->save();
    return $term;
  }

  /**
   * Renders a violation list as "path: message" for a failure diagnostic.
   *
   * @param \Drupal\Core\Entity\EntityConstraintViolationListInterface $violations
   *   The list to render.
   *
   * @return string
   *   One entry per violation, pipe-separated.
   */
  private function renderViolations(mixed $violations): string {
    $seen = [];
    foreach ($violations as $violation) {
      $seen[] = $violation->getPropertyPath() . ': ' . (string) $violation->getMessage();
    }
    return implode(' | ', $seen);
  }

  /**
   * The same name twice in one workspace AND one vocabulary is rejected.
   */
  public function testDuplicateInSameWorkspaceAndVocabularyIsRejected(): void {
    $workspace = $this->workspace('a');
    $this->term($workspace, 'bb_labels', 'work:code');

    $duplicate = BbTerm::create([
      'vid' => 'bb_labels',
      'name' => 'work:code',
      'workspace_id' => $workspace->id(),
    ]);

    $violations = $duplicate->validate();
    self::assertCount(1, $violations, $this->renderViolations($violations));
    self::assertSame('name', $violations->get(0)->getPropertyPath());
  }

  /**
   * The live `codex` pair — one label, one capability tag — stays valid.
   *
   * This is the fact that put `vid` in the key: on the deployed instance
   * `codex` exists in both vocabularies, so a (workspace_id, name) constraint
   * would have failed on real data and forced a merge or a rename.
   */
  public function testTheCodexPairAcrossVocabulariesIsValid(): void {
    $workspace = $this->workspace('a');
    $this->term($workspace, 'bb_labels', 'codex');

    $tag = BbTerm::create([
      'vid' => 'bb_capability_tags',
      'name' => 'codex',
      'workspace_id' => $workspace->id(),
    ]);

    $violations = $tag->validate();
    self::assertCount(0, $violations, $this->renderViolations($violations));
  }

  /**
   * The same name in another workspace is valid — that is the whole point.
   */
  public function testTheSameNameInAnotherWorkspaceIsValid(): void {
    $this->term($this->workspace('a'), 'bb_labels', 'work:code');

    $other = BbTerm::create([
      'vid' => 'bb_labels',
      'name' => 'work:code',
      'workspace_id' => $this->workspace('b')->id(),
    ]);

    $violations = $other->validate();
    self::assertCount(0, $violations, $this->renderViolations($violations));
  }

  /**
   * Re-validating an unchanged saved term does not collide with itself.
   */
  public function testTermDoesNotCollideWithItself(): void {
    $term = $this->term($this->workspace('a'), 'bb_labels', 'work:docs');

    $violations = $term->validate();
    self::assertCount(0, $violations, $this->renderViolations($violations));
  }

  /**
   * A term with no workspace raises no uniqueness violation.
   *
   * Between the storage install and the backfill every row looks like this, and
   * a uniqueness check that treated NULL as a scope would report all of them as
   * colliding with each other.
   */
  public function testWorkspacelessTermsDoNotCollideWithEachOther(): void {
    $first = BbTerm::create(['vid' => 'bb_labels', 'name' => 'unscoped']);
    $first->save();

    $second = BbTerm::create(['vid' => 'bb_labels', 'name' => 'unscoped']);
    $violations = $second->validate();

    self::assertGreaterThan(0, $violations->count(), 'The required field still reports.');
    foreach ($violations as $violation) {
      self::assertNotSame(
        'name',
        $violation->getPropertyPath(),
        'Uniqueness must abstain while workspace_id is empty.',
      );
    }
  }

}
