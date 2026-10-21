<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Cross-workspace assignment is rejected on all four fields (V2).
 *
 * BB-351 D6 as corrected at the second coding gate: TWO guards then two
 * rules. Guard A leaves emptiness to NotNull, guard B is the `administer bakers`
 * escape hatch asked as a permission (Fact 12), rule 1 is membership and rule 2
 * is the ambient match under an add-form route. One constraint class rather
 * than four, because all four fields need the same value-to-workspace walk and
 * the same guards.
 *
 * The delivered version carried a third guard that stood the whole constraint
 * down for `write bakers via session scope`. It is gone: one rule for all. An
 * agent is checked by rule 1 through its own og_membership exactly like every
 * other account, which is asserted below in both directions.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class AmbientWorkspaceScopeConstraintTest extends KernelTestBase {

  use AmbientWorkspaceTestTrait;

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
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installAmbientWorkspaceWorld();
  }

  /**
   * The four constrained fields, keyed by a readable case name.
   *
   * @return array<string, array{string, string}>
   *   Entity type id and the constrained field name.
   */
  public static function constrainedFields(): array {
    return [
      'group' => ['bb_group', 'workspace_id'],
      'team' => ['bb_team', 'workspace_id'],
      'project' => ['bb_project', 'group_id'],
      'ticket' => ['bb_ticket', 'project_id'],
    ];
  }

  /**
   * A workspace the account is not a member of cannot be assigned (rule 1).
   *
   * @param string $type
   *   The entity type id under test.
   * @param string $field
   *   The constrained field name on that type.
   */
  #[DataProvider('constrainedFields')]
  public function testForeignWorkspaceIsRejected(string $type, string $field): void {
    $this->actAsMemberOfA();
    $entity = $this->newRowPointingAt($type, $field, 'b');

    $messages = $this->scopeViolations($entity);

    self::assertCount(1, $messages, implode(' | ', $messages));
    self::assertStringContainsString('not one of yours', $messages[0]);
  }

  /**
   * The account's own workspace is accepted on every one of the four fields.
   *
   * @param string $type
   *   The entity type id under test.
   * @param string $field
   *   The constrained field name on that type.
   */
  #[DataProvider('constrainedFields')]
  public function testOwnWorkspaceIsAccepted(string $type, string $field): void {
    $this->actAsMemberOfA();
    $entity = $this->newRowPointingAt($type, $field, 'a');

    self::assertSame([], $this->scopeViolations($entity));
  }

  /**
   * Under a route context the value must match the workspace being created in.
   *
   * The actor is a member of BOTH workspaces, so rule 1 passes for either side
   * and only rule 2 can reject — which is the only way to observe it.
   */
  public function testAmbientMismatchIsRejectedUnderRouteContext(): void {
    $account = $this->memberOfBothWorkspaces();
    $this->enterAddFormRouteWithWorkspace($this->fixture('a', 'bb_workspace'));
    $this->switchTo($account);
    $entity = $this->newRowPointingAt('bb_group', 'workspace_id', 'b');

    $messages = $this->scopeViolations($entity);

    self::assertCount(1, $messages, implode(' | ', $messages));
    self::assertStringContainsString('but you are creating in', $messages[0]);
  }

  /**
   * Without a route context rule 2 stays silent (D6).
   *
   * The same account, no route. There is no other workspace source, so the
   * source is `none` and rule 2 must not fire; rule 1 passes because workspace
   * B is one of this account's own. This is the JSON:API shape: the payload
   * names its parent, rule 1 is the gate, rule 2 has nothing to compare
   * against.
   */
  public function testAmbientRuleIsInertWithoutRouteContext(): void {
    $account = $this->memberOfBothWorkspaces();
    $this->switchTo($account);
    $entity = $this->newRowPointingAt('bb_group', 'workspace_id', 'b');

    self::assertSame([], $this->scopeViolations($entity));
  }

  /**
   * An edit-form route is not create context, so rule 2 stays silent there.
   *
   * The edit form carries `{bb_workspace}` exactly like the add form; only
   * the add form means "I am creating here". Without this the constraint would
   * reject a legitimate move between two of the account's OWN workspaces
   * whenever the account happened to be standing on some workspace-carrying
   * page.
   */
  public function testAmbientRuleIsInertOnAnEditFormRoute(): void {
    $account = $this->memberOfBothWorkspaces();
    $this->enterEditFormRouteWithWorkspace(
      $this->fixture('a', 'bb_workspace'),
      $this->fixture('a', 'bb_group'),
    );
    $this->switchTo($account);
    $entity = $this->newRowPointingAt('bb_group', 'workspace_id', 'b');

    self::assertSame([], $this->scopeViolations($entity));
  }

  /**
   * The admin permission returns before either rule (guard B).
   *
   * An account with `administer bakers` and no membership at all: a foreign
   * value is accepted, which is the global escape hatch of criterion 5.
   *
   * @param string $type
   *   The entity type id under test.
   * @param string $field
   *   The constrained field name on that type.
   */
  #[DataProvider('constrainedFields')]
  public function testAdministerBbBypassesBothRules(string $type, string $field): void {
    $this->switchTo($this->createAccount('scope-admin', ['administer bakers']));
    $entity = $this->newRowPointingAt($type, $field, 'b');

    self::assertSame([], $this->scopeViolations($entity));
  }

  /**
   * A session-scoped agent without a membership is rejected — one rule for all.
   *
   * The delivered version carried a guard C that stood the constraint down for
   * `write bakers via session scope` entirely, on the reasoning that an agent's
   * bound is its RUN rather than a membership. That is an exemption from the
   * tenancy boundary, not a bound: it let any session-scoped account write into
   * any workspace. The decision at the second coding gate is one rule for all —
   * an agent is a member or it is not, and rule 1 asks the same question of it
   * as of anybody else.
   */
  public function testSessionScopedWriteWithoutMembershipIsRejected(): void {
    $this->switchTo($this->createAccount('scope-agent', [
      'write bakers via session scope',
    ]));
    $entity = $this->newRowPointingAt('bb_ticket', 'project_id', 'b');

    $messages = $this->scopeViolations($entity);

    self::assertCount(1, $messages, implode(' | ', $messages));
    self::assertStringContainsString('not one of yours', $messages[0]);
  }

  /**
   * The same agent WITH the membership writes exactly as before.
   *
   * The other half of "one rule for all": deleting guard C narrows nothing an
   * entitled agent could do. This is the shape the seeded world already has —
   * the e2e agent holds a workspace membership as well as a project one.
   */
  public function testSessionScopedWriteWithMembershipIsAccepted(): void {
    $agent = $this->createAccount('scope-agent-member', [
      'write bakers via session scope',
    ]);
    $this->addMembership($this->fixture('b', 'bb_workspace'), $agent, ['member']);
    $this->switchTo($agent);
    $entity = $this->newRowPointingAt('bb_ticket', 'project_id', 'b');

    self::assertSame([], $this->scopeViolations($entity));
  }

  /**
   * A value whose workspace cannot be resolved gets its OWN message.
   *
   * The delivered version reused the membership message with an em-dash where
   * the workspace name goes, which reads as "Workspace — is not one of yours"
   * and sends the reader looking for a membership problem that does not exist.
   * The row is orphaned; say that.
   */
  public function testOrphanedValueRaisesItsOwnMessage(): void {
    $this->actAsMemberOfA();
    $orphan = $this->createEntity('bb_group', [
      'name' => 'group-without-workspace',
      'owner_user_id' => $this->member('a')->id(),
    ]);
    $entity = $this->newRowPointingAt('bb_project', 'group_id', 'a');
    $entity->set('group_id', $orphan->id());

    $messages = $this->scopeViolations($entity);

    self::assertCount(1, $messages, implode(' | ', $messages));
    self::assertStringContainsString('belongs to no workspace', $messages[0]);
    self::assertStringNotContainsString('not one of yours', $messages[0]);
  }

  /**
   * Every item of the field is inspected, not only the first.
   *
   * None of the four constrained fields is multi-value today, so the item list
   * is built directly rather than by inventing a field with a cardinality no
   * production entity has: what is under test is the validator's iteration, and
   * a `first()`-only validator passes a foreign value at delta 1 straight
   * through. Delta 0 is deliberately legitimate, so the only thing that can
   * raise a violation here is that delta 1 was looked at.
   */
  public function testEveryItemIsInspectedNotOnlyTheFirst(): void {
    $this->actAsMemberOfA();
    $entity = $this->newRowPointingAt('bb_group', 'workspace_id', 'a');
    $entity->set('workspace_id', [
      ['target_id' => $this->fixture('a', 'bb_workspace')->id()],
      ['target_id' => $this->fixture('b', 'bb_workspace')->id()],
    ]);

    $messages = $this->scopeViolations($entity);

    self::assertCount(1, $messages, implode(' | ', $messages));
    self::assertStringContainsString('not one of yours', $messages[0]);
  }

  /**
   * An empty value is NotNull's business, not this constraint's (guard A).
   *
   * @param string $type
   *   The entity type id under test.
   * @param string $field
   *   The constrained field name on that type.
   */
  #[DataProvider('constrainedFields')]
  public function testEmptyValueAddsNoViolationOfThisConstraint(string $type, string $field): void {
    $this->actAsMemberOfA();
    $entity = $this->newRowPointingAt($type, $field, 'a');
    $entity->set($field, NULL);

    self::assertSame([], $this->scopeViolations($entity));
  }

  /**
   * Makes the member of workspace A the acting account.
   */
  private function actAsMemberOfA(): void {
    $account = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    $this->switchTo($account);
  }

  /**
   * Switches the current user for the rest of the test method.
   *
   * @param \Drupal\user\UserInterface $account
   *   The account to act as.
   */
  private function switchTo(UserInterface $account): void {
    $this->container->get('account_switcher')->switchTo($account);
  }

  /**
   * Builds an unsaved row of $type whose constrained field points at $side.
   *
   * The referenced value differs per type, which is the whole point of the
   * table: workspace_id takes the workspace itself, group_id takes the side's
   * group, project_id takes the side's project.
   *
   * @param string $type
   *   The entity type id to create.
   * @param string $field
   *   The constrained field to fill.
   * @param string $side
   *   The side of the two-workspace world to point at, 'a' or 'b'.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The unsaved row.
   */
  private function newRowPointingAt(string $type, string $field, string $side): ContentEntityInterface {
    $referenced = match ($field) {
      'workspace_id' => $this->fixture($side, 'bb_workspace'),
      'group_id' => $this->fixture($side, 'bb_group'),
      'project_id' => $this->fixture($side, 'bb_project'),
      default => self::fail("No fixture for field $field."),
    };
    // Every one of the four types has required fields besides the constrained
    // one; fill them so the row is otherwise well-formed.
    $values = match ($type) {
      'bb_group', 'bb_team' => ['name' => 'probe'],
      'bb_project' => ['name' => 'probe'],
      'bb_ticket' => ['title' => 'probe', 'workflow' => 'bb_feature'],
      default => self::fail("No probe values for type $type."),
    };
    $values[$field] = $referenced->id();
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($type)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    return $entity;
  }

  /**
   * The violation messages this constraint added, and only those.
   *
   * Filtering by message rather than counting: a probe row carries unrelated
   * violations — most obviously core's ValidReference on a target the acting
   * account may not read — and asserting on a count would pass or fail for the
   * wrong reason.
   *
   * @param \Drupal\Core\Entity\ContentEntityInterface $entity
   *   The row to validate.
   *
   * @return array<int, string>
   *   The messages this constraint contributed.
   */
  private function scopeViolations(ContentEntityInterface $entity): array {
    $messages = [];
    foreach ($entity->validate() as $violation) {
      $message = (string) $violation->getMessage();
      if (str_contains($message, 'not one of yours')
        || str_contains($message, 'belongs to no workspace')
        || str_contains($message, 'but you are creating in')) {
        $messages[] = $message;
      }
    }
    return $messages;
  }

}
