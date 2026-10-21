<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A row may not be pointed into a tenancy the actor has no rank in (BB-359).
 *
 * Layer B fences view/update/delete, and it cannot fence a create:
 * `checkCreateAccess()` is handed a bundle and a context but no entity, so
 * there is no group to resolve. A row's tenancy is decided by the reference it
 * is created WITH, so the fence for that case belongs on the reference itself.
 *
 * The constraint also covers something no access check ever could: RE-POINTING
 * a saved row into another tenancy. `update` is checked against the entity as
 * it is stored, so an actor allowed to edit its own workspace's ticket would
 * pass that check and then move the ticket into a workspace it has no rank in.
 *
 * JSON:API validates on every write, which is the surface the agents and
 * `bakers ui` use.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class GroupScopeConstraintTest extends KernelTestBase {

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
   * The actor, holding a rank in workspace B and nothing in workspace A.
   */
  private AccountInterface $actor;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();

    $this->actor = $this->createAccount('actor');
    $role = OgRole::load('bb_workspace-bb_workspace-lead');
    self::assertNotNull($role);
    Og::createMembership($this->fixture('b', 'bb_workspace'), $this->actor)
      ->addRole($role)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
  }

  /**
   * A new row anchored in the actor's own tenancy validates.
   *
   * Asserted first and in its own right: a constraint that rejected everything
   * would satisfy every other assertion in this class.
   */
  public function testNewRowInOwnTenancyIsAccepted(): void {
    $ticket = $this->newTicket([
      'identifier' => 'T-OK',
      'title' => 'in own workspace',
      'workflow' => 'bb_feature',
      'project_id' => $this->fixture('b', 'bb_project')->id(),
    ]);

    self::assertSame([], $this->violationsAs($ticket, $this->actor));
  }

  /**
   * A new row anchored in another tenancy is rejected on its anchor field.
   */
  public function testNewRowInForeignTenancyIsRejected(): void {
    $ticket = $this->newTicket([
      'identifier' => 'T-NO',
      'title' => 'in a foreign workspace',
      'workflow' => 'bb_feature',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
    ]);

    self::assertSame(['project_id'], $this->violationsAs($ticket, $this->actor));
  }

  /**
   * Re-pointing a saved row into another tenancy is rejected.
   *
   * The case no access check catches: `update` is decided against the STORED
   * entity, which still sits in the tenancy the actor may edit.
   */
  public function testRepointingIntoForeignTenancyIsRejected(): void {
    $ticket = $this->createEntity('bb_ticket', [
      'identifier' => 'T-MOVE',
      'title' => 'starts at home',
      'workflow' => 'bb_feature',
      'project_id' => $this->fixture('b', 'bb_project')->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    self::assertSame([], $this->violationsAs($ticket, $this->actor));

    $ticket->set('project_id', $this->fixture('a', 'bb_project')->id());
    self::assertSame(['project_id'], $this->violationsAs($ticket, $this->actor));
  }

  /**
   * An edit that leaves the anchor alone is not re-litigated.
   *
   * The regression this pins was measured, not imagined. `$entity->original` is
   * populated in EntityStorageBase::doPreSave(), which runs AFTER validation,
   * and every JSON:API write validates before saving — so an "is the anchor
   * unchanged" check that reads `original` always answers "changed", and the
   * constraint then demands `create <type>` for an edit that never touched the
   * anchor.
   *
   * The actor is a site-wide operator holding `update any bb_ticket` and NOT
   * `create bb_ticket`, with no membership anywhere. Layer B lets them
   * through — a site-wide grant is not fenced — and before the fix validation
   * then refused the save, which is a denial no access check had made and no
   * message explained.
   *
   * It is deliberately measured on an actor with no rank: every real rank
   * carries the implicit `member` role, whose set includes `create
   * bb_ticket`, so a rank-holding actor cannot show this failure at all.
   */
  public function testEditingWithoutTouchingTheAnchorIsAllowed(): void {
    $editor = $this->createAccount('editor', ['update any bb_ticket', 'view bb_ticket']);
    $ticket = $this->fixture('a', 'bb_ticket');
    self::assertTrue(
      $ticket->access('update', $editor),
      'Layer B allows the site-wide grant, so validation is the only thing left',
    );

    $ticket->set('title', 'renamed, anchor untouched');
    self::assertSame([], $this->violationsAs($ticket, $editor));
  }

  /**
   * A contributor may create a project into a team they belong to (D6).
   *
   * The positive half of BB-462's F1 repair: `create bb_project` is a
   * WORKSPACE-scoped right, so a chain that stopped at the workspace made the
   * `teams` anchor a no-op — every workspace contributor passed it for every
   * team of that workspace. The actor here holds a `teams` fixture different
   * from the actor's other memberships, isolating the fix to team membership
   * itself rather than to workspace rank.
   */
  public function testContributorCreatesProjectIntoOwnTeam(): void {
    $contributor = $this->createAccount('team-contributor');
    $contributor_role = OgRole::load('bb_workspace-bb_workspace-contributor');
    self::assertNotNull($contributor_role);
    Og::createMembership($this->fixture('b', 'bb_workspace'), $contributor)
      ->addRole($contributor_role)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    Og::createMembership($this->fixture('b', 'bb_team'), $contributor)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => 'own-team-project',
        'group_id' => $this->fixture('b', 'bb_group')->id(),
        'teams' => [$this->fixture('b', 'bb_team')->id()],
      ]);
    self::assertInstanceOf(FieldableEntityInterface::class, $project);

    self::assertSame([], $this->violationsAs($project, $contributor));
  }

  /**
   * A contributor is refused a project into a team they do NOT belong to (D6).
   *
   * The negative half. The actor holds the same workspace `contributor` role
   * as the positive case, and nothing else — the only difference is which team
   * they are a member of, which is exactly the boundary D6 asks for and F1
   * found missing.
   */
  public function testContributorIsRefusedProjectIntoForeignTeam(): void {
    $contributor = $this->createAccount('foreign-team-contributor');
    $contributor_role = OgRole::load('bb_workspace-bb_workspace-contributor');
    self::assertNotNull($contributor_role);
    Og::createMembership($this->fixture('b', 'bb_workspace'), $contributor)
      ->addRole($contributor_role)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
    // No membership in fixture('b', 'bb_team') at all: a workspace
    // contributor who has not joined the team the project is being placed
    // into.
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => 'foreign-team-project',
        'group_id' => $this->fixture('b', 'bb_group')->id(),
        'teams' => [$this->fixture('b', 'bb_team')->id()],
      ]);
    self::assertInstanceOf(FieldableEntityInterface::class, $project);

    self::assertSame(['teams'], $this->violationsAs($project, $contributor));
  }

  /**
   * The workspace admin/see-all rank reaches every team without joining (D4).
   *
   * D4 lets a workspace admin administer every project of its workspace
   * without joining any team; the `teams` anchor must not force that
   * membership onto them just to create one.
   */
  public function testWorkspaceAdminCreatesProjectIntoAnyTeamWithoutJoining(): void {
    // $this->actor already holds `bb_workspace-bb_workspace-lead` on
    // workspace 'b' and no team membership anywhere (see setUp()).
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => 'admin-project',
        'group_id' => $this->fixture('b', 'bb_group')->id(),
        'teams' => [$this->fixture('b', 'bb_team')->id()],
      ]);
    self::assertInstanceOf(FieldableEntityInterface::class, $project);

    self::assertSame([], $this->violationsAs($project, $this->actor));
  }

  /**
   * A site-wide administrator is not scoped by the constraint.
   *
   * The constraint bounds a rank, and `administer bakers` is instance-wide by
   * definition — the importer and the machine actors write across tenancies on
   * purpose.
   */
  public function testAdministratorIsNotScoped(): void {
    $admin = $this->createAccount('scope-admin', ['administer bakers']);
    $ticket = $this->newTicket([
      'identifier' => 'T-ADM',
      'title' => 'anywhere',
      'workflow' => 'bb_feature',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
    ]);

    self::assertSame([], $this->violationsAs($ticket, $admin));
  }

  /**
   * The anchor of every scoped type is constrained, not only the ticket's.
   *
   * Enumerated rather than sampled: the whole point is that no scoped type is
   * left without one, and a test that checked bb_ticket alone would pass
   * with five holes.
   */
  public function testEveryScopedAnchorCarriesTheConstraint(): void {
    $expected = [
      'bb_ticket' => 'project_id',
      'bb_comment' => 'ticket_id',
      'bb_environment' => 'project_id',
      // BB-462 D6: the create anchor moved from `group_id` to `teams`.
      'bb_project' => 'teams',
      'bb_group' => 'workspace_id',
      'bb_team' => 'workspace_id',
    ];
    $field_manager = $this->container->get('entity_field.manager');

    foreach ($expected as $entity_type_id => $field_name) {
      $definitions = $field_manager->getBaseFieldDefinitions($entity_type_id);
      self::assertArrayHasKey($field_name, $definitions, "$entity_type_id has $field_name");
      self::assertArrayHasKey(
        'BbGroupScope',
        $definitions[$field_name]->getConstraints(),
        "$entity_type_id.$field_name carries the BbGroupScope constraint",
      );
    }
  }

  /**
   * Creates an unsaved ticket.
   *
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\FieldableEntityInterface
   *   The unsaved ticket.
   */
  private function newTicket(array $values): FieldableEntityInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create($values);
    self::assertInstanceOf(FieldableEntityInterface::class, $ticket);

    return $ticket;
  }

  /**
   * Validates an entity as the given account and returns the offending fields.
   *
   * @param \Drupal\Core\Entity\FieldableEntityInterface $entity
   *   The entity to validate.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to validate as.
   *
   * @return array<string>
   *   The property paths that reported a violation, de-duplicated.
   */
  private function violationsAs(FieldableEntityInterface $entity, AccountInterface $account): array {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account);
    try {
      $violations = $entity->validate();
    }
    finally {
      $switcher->switchBack();
    }
    $fields = [];
    foreach ($violations as $violation) {
      // Only this constraint's violations are of interest; a fixture missing an
      // unrelated required value would otherwise read as a scope failure.
      if (str_contains((string) $violation->getMessage(), 'tenancy')) {
        $fields[] = explode('.', $violation->getPropertyPath())[0];
      }
    }

    return array_values(array_unique($fields));
  }

}
