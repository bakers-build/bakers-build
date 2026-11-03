<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\entity\QueryAccess\QueryAccessHandlerInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The owner grant survives the read scope, and the scope is cached per user.
 *
 * V7 and V8. `bb_run` and `bb_conductor` are the two types whose handler
 * already grants the row's owner (BB-305 D6), and `bakers ui`'s Conductors tab
 * reads both through that grant alone — the `session` role holds no
 * `view bb_conductor`. So the composition criterion is not decoration: losing
 * the owner grant would break the cockpit for exactly the accounts this epic is
 * built for (AC 5).
 *
 * V8 asserts the cache metadata directly because its failure mode — one
 * account's rows served from another's cached response — is invisible in a
 * single-user test (R6).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceReadScopeOwnerCompositionTest extends KernelTestBase {

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
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
  }

  /**
   * An owner with no membership at all still sees its own conductor and run.
   *
   * The guard-3 falsification does not reach these two types, and cannot: their
   * scope condition always carries the owner term, so the group is never empty
   * and never falsified. That is the mechanical reason the owner grant is safe,
   * rather than a special case bolted beside it.
   */
  public function testOwnerWithNoMembershipKeepsItsOwnRows(): void {
    $owner = $this->createAccount('lone-owner', ['register bakers conductor']);
    [$conductor, $run] = $this->createOwnedConductorAndRun($owner, 'lone');

    self::assertSame(
      [(int) $conductor->id()],
      $this->queryIdsAs('bb_conductor', $owner),
      'The BB-305 owner grant is intact for an account OG knows nothing '
      . 'about — which is every conductor before anybody invites it.',
    );
    self::assertSame(
      [(int) $run->id()],
      $this->queryIdsAs('bb_run', $owner),
    );
  }

  /**
   * A project member sees the project's conductor and run without owning them.
   */
  public function testProjectMemberSeesRowsItDoesNotOwn(): void {
    $account = $this->createAccount('composing-member', [
      'view bb_conductor', 'view bb_run',
    ]);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);

    self::assertSame(
      [(int) $this->fixture('a', 'bb_conductor')->id()],
      $this->queryIdsAs('bb_conductor', $account),
    );
    self::assertSame(
      [(int) $this->fixture('a', 'bb_run')->id()],
      $this->queryIdsAs('bb_run', $account),
    );
  }

  /**
   * The two paths compose: own rows plus the project's rows, and nothing else.
   *
   * The account's own conductor belongs to no project at all, so it is
   * reachable only through the owner term. If the project condition had
   * replaced the owner grant instead of joining it, this is the assertion that
   * would fail — and the unowned row of the other workspace is what shows the
   * join did not widen into "everything".
   */
  public function testOwnRowsAndProjectRowsAreBothVisible(): void {
    $account = $this->createAccount('composing-owner', [
      'view bb_conductor', 'view bb_run', 'register bakers conductor',
    ]);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);
    [$mine] = $this->createOwnedConductorAndRun($account, 'projectless');

    $visible = $this->queryIdsAs('bb_conductor', $account);
    self::assertContains(
      (int) $mine->id(),
      $visible,
      'Own row, reachable through no project.',
    );
    self::assertContains(
      (int) $this->fixture('a', 'bb_conductor')->id(),
      $visible,
      'Project row, not owned.',
    );
    self::assertNotContains(
      (int) $this->fixture('b', 'bb_conductor')->id(),
      $visible,
      'A row that is neither owned nor in a visible project stays hidden.',
    );
  }

  /*
   * testRegisteringConductorGrantsItsOwnerTheWorkspaceAppRole() is GONE
   * (BB-462 D9): registering a conductor no longer writes any membership
   * at all — bb_core_bb_conductor_insert() no longer places its owner
   * in an `app` rank (the role and the placement hook are both retired),
   * because a conductor's OAuth identity already sees what its owning user
   * sees through the user's own product rank. There is no self-granting
   * composition left to test: the R8 trade this test made visible is
   * resolved by removal rather than by keeping the wide, self-granting rank.
   */

  /**
   * The narrowed group depends on the user and on the membership list.
   *
   * V8. `user` rather than `user.permissions`, because two accounts with the
   * same permissions have different memberships; `og_membership_list`, because
   * a membership written elsewhere changes what every one of these queries
   * returns.
   */
  public function testTheNarrowedGroupCarriesItsCacheability(): void {
    $account = $this->createAccount('cacheable-reader', ['view bb_ticket']);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);

    $handler = $this->container->get('entity_type.manager')
      ->getHandler('bb_ticket', 'query_access');
    self::assertInstanceOf(QueryAccessHandlerInterface::class, $handler);
    $conditions = $handler->getConditions('view', $account);

    self::assertContains('user', $conditions->getCacheContexts());
    self::assertContains('og_membership_list', $conditions->getCacheTags());
  }

  /**
   * Creates a conductor owned by the account plus one run on it.
   *
   * @param \Drupal\user\UserInterface $account
   *   The owning account.
   * @param string $name
   *   The conductor's machine id and label.
   * @param int|null $project_id
   *   An optional project to attach the conductor to.
   *
   * @return array{\Drupal\Core\Entity\ContentEntityInterface, \Drupal\Core\Entity\ContentEntityInterface}
   *   The conductor and the run.
   */
  private function createOwnedConductorAndRun(UserInterface $account, string $name, ?int $project_id = NULL): array {
    $values = [
      'label' => $name,
      'owner_user_id' => $account->id(),
    ];
    if ($project_id !== NULL) {
      $values['project_id'] = $project_id;
    }
    $conductor = $this->createEntity('bb_conductor', $values);
    $run = $this->createEntity('bb_run', [
      'conductor_id' => $conductor->id(),
      'owner_user_id' => $account->id(),
      'state' => 'claimed',
    ]);
    return [$conductor, $run];
  }

}
