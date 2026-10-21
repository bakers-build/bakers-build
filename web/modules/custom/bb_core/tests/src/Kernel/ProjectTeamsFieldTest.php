<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Field\FieldStorageDefinitionInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A project belongs to at least one team (BB-419 D1, D2).
 *
 * THE MINIMUM-ONE RULE IS `setRequired(TRUE)`, NOT A CUSTOM CONSTRAINT. On a
 * multi-value field `BaseFieldDefinition::setRequired()` puts `NotNull` on the
 * ITEM LIST, and core's validator violates on an empty list — which is exactly
 * "at least one value". Writing a constraint of our own would restate what the
 * field definition already says, and it would say it in a second place that can
 * drift.
 *
 * THE ASSERTION IS ON THE PROPERTY PATH, and that is the point rather than a
 * detail. `save()` does not validate in Drupal, so "saving a project without a
 * team fails" is not a thing that happens: a save-based assertion would either
 * be green because nothing validated, or red because of some unrelated missing
 * value. `validate()` returning a violation whose `propertyPath` is `teams` is
 * the checkable form of the rule, and it is the form the surfaces that DO
 * validate — the entity form and JSON:API — actually meet.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectTeamsFieldTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
  ];

  /**
   * The actor, holding a lead rank in workspace B and nothing in workspace A.
   */
  private AccountInterface $actor;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();

    $this->actor = $this->createAccount('teams-actor');
    $role = OgRole::load('bb_workspace-bb_workspace-lead');
    self::assertNotNull($role);
    Og::createMembership($this->fixture('b', 'bb_workspace'), $this->actor)
      ->addRole($role)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
  }

  /**
   * The field is an unlimited, required reference to bb_team.
   *
   * Every part of D1 in one place, because each of them is separately load
   * bearing: the target type is what makes the reference a team, the
   * cardinality is what makes a project able to belong to several, and
   * `isRequired()` IS the minimum-one rule.
   */
  public function testTeamsFieldShape(): void {
    $definitions = $this->container->get('entity_field.manager')
      ->getBaseFieldDefinitions('bb_project');

    self::assertArrayHasKey('teams', $definitions);
    $teams = $definitions['teams'];
    self::assertSame('entity_reference', $teams->getType());
    self::assertSame('bb_team', $teams->getSetting('target_type'));
    // Read off the STORAGE definition, which is where cardinality lives:
    // FieldDefinitionInterface makes no such promise, and calling it there
    // happens to work only because the base-field implementation is both.
    self::assertSame(
      FieldStorageDefinitionInterface::CARDINALITY_UNLIMITED,
      $teams->getFieldStorageDefinition()->getCardinality(),
    );
    self::assertTrue($teams->isRequired(), 'teams is required, which is the minimum-one rule');
    self::assertArrayHasKey(
      'BbWorkspaceScope',
      $teams->getConstraints(),
      'teams carries the workspace-scope constraint (D2)',
    );
  }

  /**
   * A project with no team reports a violation, and it is ON `teams`.
   */
  public function testEmptyTeamsViolatesOnTeams(): void {
    $project = $this->newProject([
      'name' => 'teamless',
      'group_id' => $this->fixture('b', 'bb_group')->id(),
    ]);

    self::assertContains('teams', $this->violatingPaths($project, $this->actor));
  }

  /**
   * A project naming a team in its own workspace validates cleanly.
   *
   * Asserted in its own right: a rule that rejected every project would
   * satisfy the assertion above without being the rule anybody wanted.
   */
  public function testProjectNamingOneTeamValidates(): void {
    $project = $this->newProject([
      'name' => 'crewed',
      'group_id' => $this->fixture('b', 'bb_group')->id(),
      'teams' => [$this->fixture('b', 'bb_team')->id()],
    ]);

    self::assertSame([], $this->violatingPaths($project, $this->actor));
  }

  /**
   * A team outside the actor's own tenancy is refused on `teams` (D2).
   *
   * This is the half that is additive to the ticket text. Without the
   * constraint a plain JSON:API write points a project at a team the actor has
   * no rank over, and nothing says no.
   */
  public function testTeamOutsideTheActorsTenancyIsRejected(): void {
    $project = $this->newProject([
      'name' => 'foreign crew',
      'group_id' => $this->fixture('b', 'bb_group')->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
    ]);

    self::assertContains('teams', $this->violatingPaths($project, $this->actor));
  }

  /**
   * The accessor hands back the team entities, in field order.
   */
  public function testGetTeamsReturnsTheReferencedTeams(): void {
    $team = $this->fixture('b', 'bb_team');
    $project = $this->createEntity('bb_project', [
      'name' => 'accessor',
      'group_id' => $this->fixture('b', 'bb_group')->id(),
      'teams' => [$team->id()],
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    self::assertInstanceOf(BbProjectInterface::class, $project);

    $ids = array_map(
      static fn ($resolved): string => (string) $resolved->id(),
      $project->getTeams(),
    );
    self::assertSame([(string) $team->id()], $ids);
  }

  /**
   * Creates an unsaved project.
   *
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\FieldableEntityInterface
   *   The unsaved project.
   */
  private function newProject(array $values): FieldableEntityInterface {
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create($values + ['owner_user_id' => $this->worldOwner->id()]);
    self::assertInstanceOf(FieldableEntityInterface::class, $project);

    return $project;
  }

  /**
   * Validates as the given account and returns the offending FIELD names.
   *
   * Each path is truncated at the first dot, so `teams.0.target_id` and `teams`
   * both come back as `teams`. This docblock used to claim the opposite of the
   * code below, which is worth correcting rather than leaving for a reader to
   * discover: a comment that contradicts its function is worse than no comment,
   * because it is believed.
   *
   * Truncating is the right answer for what the three callers ask, and the
   * distinction it collapses is not one they depend on. The empty-list rule can
   * only ever report on `teams` itself — `setRequired()` puts `NotNull` on the
   * ITEM LIST, and an empty list has no delta 0 for a violation to land on — so
   * that assertion is exact either way. The workspace-scope rule reports on a
   * delta, and naming the field is precisely what that caller wants to assert.
   * What no caller wants is to spell out a delta index, which would make the
   * assertion depend on how many teams the fixture happened to name.
   *
   * @param \Drupal\Core\Entity\FieldableEntityInterface $entity
   *   The entity to validate.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to validate as.
   *
   * @return array<string>
   *   The field names that reported a violation, de-duplicated.
   */
  private function violatingPaths(FieldableEntityInterface $entity, AccountInterface $account): array {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account);
    try {
      $violations = $entity->validate();
    }
    finally {
      $switcher->switchBack();
    }
    $paths = [];
    foreach ($violations as $violation) {
      $paths[] = explode('.', $violation->getPropertyPath())[0];
    }

    return array_values(array_unique($paths));
  }

}
