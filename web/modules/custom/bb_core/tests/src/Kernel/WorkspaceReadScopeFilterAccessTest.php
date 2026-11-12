<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandlerInterface;
use Drupal\jsonapi\JsonApiFilter;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A workspace-scoped query filter must not empty every filtered JSON:API read.
 *
 * This is V2, and it is the first test of BB-318 on purpose. Fact 5 is the
 * highest-consequence invariant in the change and the only one whose failure is
 * invisible: `entity_jsonapi_entity_filter_access()` maps a condition group
 * only when every member is an owner or published condition, so the moment the
 * group carries a workspace scope it returns `[]`. With no module granting a
 * subset, `TemporaryQueryGuard::getAccessConditionForKnownSubsets()` falls
 * through to `alwaysFalse()` — every filtered collection read answers HTTP 200
 * with zero rows, writes no log line, and looks exactly like an empty world.
 *
 * The three cases are, in order: the trap is real in this tree; bb_core
 * closes it for every type it narrows; and an account that may see nothing gets
 * no filter oracle either.
 *
 * @see bb_core_jsonapi_entity_filter_access()
 * @see \Drupal\bb_core\EventSubscriber\WorkspaceReadScopeSubscriber
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceReadScopeFilterAccessTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image', 'serialization', 'jsonapi',
    'bb_core',
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
   * The contrib mapper cannot express a workspace scope, so it grants nothing.
   *
   * This case used to be demonstrated on `bb_term`, the one bakers.build type
   * that was deliberately NOT narrowed, and its own docblock warned that the
   * trick only worked while such a type existed. BB-339 removed the last one —
   * all eleven bakers.build content entity types are in scope now — so the
   * "before" state is no longer reachable by choosing a type.
   *
   * Two seams replace it, and together they say more than the original did:
   *
   * - The ADMIN BYPASS produces the empty condition group on any in-scope type
   *   (subscriber guard 2), which is exactly the state `entity` reads as "may
   *   filter among all".
   * - Measuring the `entity` module's implementation ALONE, rather than the
   *   combined result, keeps the proof about contrib. The combined result is
   *   now allowed for a scoped member — that is bb_core's hook doing its job,
   *   and asserting on it would test the fix instead of the trap.
   */
  public function testWorkspaceScopedGroupIsUnmappableByTheEntityModule(): void {
    // An account holding the type's admin permission is not narrowed at all, so
    // its group is empty. Since entity 1.8 the contrib mapper grants nothing
    // even then; only bb_core's hook gives the admin AMONG_ALL back.
    $admin = $this->createAccount('trap-admin', ['view bb_term', 'administer bakers']);
    self::assertCount(
      0,
      $this->conditionsFor('bb_term', $admin),
      'The admin bypass leaves the condition group empty.',
    );
    self::assertFalse(
      $this->filterAccess('bb_term', $admin, 'entity')->isAllowed(),
      'Over an empty group the entity module alone grants no AMONG_ALL.',
    );
    self::assertTrue(
      $this->filterAccess('bb_term', $admin)->isAllowed(),
      'bb_core grants the unnarrowed admin AMONG_ALL, so filtered reads stay full.',
    );

    // A plain member IS narrowed, and a workspace condition is neither the
    // owner nor the published key, so the mapper returns nothing for it.
    $member = $this->createAccount('trap-member', ['view bb_term']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $member, ['member']);
    self::assertGreaterThan(
      0,
      $this->conditionsFor('bb_term', $member)->count(),
      'The read scope narrows bb_term for a plain member.',
    );
    self::assertFalse(
      $this->filterAccess('bb_term', $member, 'entity')->isAllowed(),
      'A workspace condition is unmappable, so the entity module grants no '
      . 'AMONG_ALL — which is exactly the silent-empty trap bb_core closes.',
    );
  }

  /**
   * Every type bb_core narrows also gets its filter oracle back.
   *
   * The set is read from the subscriber rather than restated, so a type
   * narrowed without being covered by the hook fails here instead of in
   * production (spec R1). This is the assertion that turns Fact 5 from a
   * footnote into a gate.
   */
  public function testBbGrantsFilterAccessForEveryNarrowedType(): void {
    $account = $this->createAccount('scoped-reader', [
      'view bb_workspace', 'view bb_group', 'view bb_team', 'view bb_project',
      'view bb_ticket', 'view bb_ticket_template', 'view bb_environment', 'view bb_conductor',
      'view bb_machine', 'view bb_term', 'view bb_invite',
      'view bb_run', 'view bb_comment', 'access user profiles',
      'view bakers memberships',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);

    foreach (array_keys(self::inScopeEntityTypes()) as $entity_type_id) {
      // The two halves belong in one assertion pair: a narrowed group without a
      // granted subset is the silent-empty state, and a granted subset over an
      // unnarrowed group would mean nothing was scoped at all.
      $conditions = $this->conditionsFor($entity_type_id, $account);
      self::assertGreaterThan(
        0,
        $conditions->count(),
        "The read scope must narrow $entity_type_id for a plain member.",
      );
      self::assertTrue(
        $this->filterAccess($entity_type_id, $account)->isAllowed(),
        "bb_core must grant filter access for the narrowed $entity_type_id, "
        . 'or every filtered read of it silently returns zero rows.',
      );
    }
  }

  /**
   * An account whose scope is empty gets no rows and no filter oracle.
   *
   * The mirror image of the case above, and the reason the hook cannot simply
   * return `allowed()` unconditionally: for a falsified group `entity` reports
   * `[]`, and bb_core has to report the same or it would claim filtering is
   * safe over a set the query has already emptied.
   */
  public function testEmptyScopeYieldsNoFilterAccess(): void {
    $stranger = $this->createAccount('stranger', ['view bb_ticket']);

    self::assertFalse(
      $this->filterAccess('bb_ticket', $stranger)->isAllowed(),
      'No membership means no rows, so no subset may be filtered either.',
    );
    self::assertTrue(
      $this->conditionsFor('bb_ticket', $stranger)->isAlwaysFalse(),
      'The read scope falsifies the query for an account with no membership.',
    );
  }

  /**
   * Returns the combined AMONG_ALL access result for an entity type.
   *
   * Mirrors TemporaryQueryGuard::getAccessResultsFromEntityFilterHook() rather
   * than driving HTTP: the guard is static, the seam is the hook, and a kernel
   * test that booted a JSON:API request would assert the same value one layer
   * further from where it is decided.
   *
   * @param string $entity_type_id
   *   The entity type to ask about.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check access for.
   * @param string|null $only_module
   *   When given, only that module's implementation is invoked. Used to prove
   *   what CONTRIB can express, which the combined result no longer shows once
   *   bb_core grants for the same type.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   The combined result for the AMONG_ALL subset.
   */
  private function filterAccess(string $entity_type_id, AccountInterface $account, ?string $only_module = NULL): AccessResultInterface {
    $entity_type = $this->container->get('entity_type.manager')
      ->getDefinition($entity_type_id);
    $combined = AccessResult::neutral();
    $hooks = [
      'jsonapi_entity_filter_access',
      'jsonapi_' . $entity_type_id . '_filter_access',
    ];
    foreach ($hooks as $hook) {
      $this->container->get('module_handler')->invokeAllWith(
        $hook,
        function (callable $implementation, string $module) use (&$combined, $entity_type, $account, $only_module): void {
          if ($only_module !== NULL && $module !== $only_module) {
            return;
          }
          $results = $implementation($entity_type, $account);
          if (is_array($results) && isset($results[JsonApiFilter::AMONG_ALL])) {
            $combined = $combined->orIf($results[JsonApiFilter::AMONG_ALL]);
          }
        },
      );
    }
    return $combined;
  }

  /**
   * Returns the query access conditions an entity type builds for an account.
   *
   * @param string $entity_type_id
   *   The entity type to ask about.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to build conditions for.
   *
   * @return \Drupal\entity\QueryAccess\ConditionGroup
   *   The finished condition group.
   */
  private function conditionsFor(string $entity_type_id, AccountInterface $account): ConditionGroup {
    $handler = $this->container->get('entity_type.manager')
      ->getHandler($entity_type_id, 'query_access');
    self::assertInstanceOf(QueryAccessHandlerInterface::class, $handler);
    return $handler->getConditions('view', $account);
  }

}
