<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;
use Drupal\bb_core\Access\BbRankEntityFence;
use Drupal\bb_core\Access\BbWorkspaceReadScope;
use Drupal\bb_core\Access\WorkspaceResolver;
use Drupal\bb_core\EventSubscriber\WorkspaceReadScopeSubscriber;
use Drupal\bb_core\Plugin\Validation\Constraint\BbGroupScopeConstraint;
use PHPUnit\Framework\Attributes\Group;

/**
 * The tenancy graph is restated in four places; this compares them (D5).
 *
 * The plan calls this "the durable outcome of the change, more than any
 * single edge is", and a review sent the ticket back to `coding` for its
 * absence: every other check here is a statement about ONE file or ONE
 * runtime seam, and none of them can see that the fence's hop map, the
 * read-scope subscriber's rule map, the workspace resolver's chain constant
 * and the group-scope constraint's anchor map agree with each other — a
 * fifth, cross-cutting fact none of the four sources can check about itself.
 *
 * WHY FOUR SOURCES OF DIFFERENT SHAPES, NOT ONE COMPARABLE MAP. Each answers
 * a different question about the same graph — "which group's rank reaches
 * this row" (fence), "which id set does this row's visibility read from"
 * (read-scope), "which single workspace does this row belong to" (resolver),
 * "which reference anchors this row's tenancy on write" (constraint) — so a
 * literal `assertSame()` of two arrays would be comparing incompatible
 * shapes, which is exactly the trap a hand-rolled "unify them" refactor would
 * fall into (an explicit non-goal — spec *Out of scope*, plan's deliberate
 * non-goals). What IS comparable, and what this class asserts, is the
 * narrower fact that actually breaks silently when a graph edge changes: the
 * FIRST-HOP FIELD NAME each source reads to leave a given entity type, for
 * every type more than one source names it for.
 *
 * Runs without a bootstrapped site — every value read here is a PHP class
 * constant or a private static method with no service dependency, so this is
 * a Unit test rather than a Kernel one.
 */
#[Group('bb_core')]
final class TenancyGraphDriftTest extends UnitTestCase {

  /**
   * Single-valued types: the fence's hop and the constraint's anchor agree.
   *
   * `BbGroupScopeConstraint::ANCHORS` is deliberately a SUBSET of
   * `BbRankEntityFence::HOP_FIELDS` — it names only the types a human can
   * actually create/re-point (its own docblock: `bb_run` and
   * `bb_conductor` are absent on purpose, written only by their owning
   * machine). So this compares in one direction: every type the constraint
   * DOES anchor must read the fence's own hop for that type, never the other
   * way round.
   */
  public function testConstraintAnchorsAgreeWithFenceHopsForSharedTypes(): void {
    $hops = BbRankEntityFence::HOP_FIELDS;
    $anchors = BbGroupScopeConstraint::ANCHORS;

    foreach ($anchors as $entity_type_id => $anchor_field) {
      if ($entity_type_id === 'bb_project') {
        // BB-462 D6: the project's anchor is `teams`, a DIFFERENT edge from
        // the fence's `bb_project` chain (which walks its own workspace hop
        // too) — asserted on its own below, not through this loop.
        continue;
      }
      self::assertArrayHasKey(
        $entity_type_id,
        $hops,
        "$entity_type_id is anchored by the constraint but the fence declares no hop for it — the next edge was added to one and not the other.",
      );
      self::assertSame(
        $hops[$entity_type_id],
        $anchor_field,
        "$entity_type_id: the fence's hop field and the constraint's anchor field must be the same edge.",
      );
    }
  }

  /**
   * Single-valued types: the fence's hop is the resolver's FIRST chain hop.
   *
   * `WorkspaceResolver::CHAINS` answers a different question — the full path
   * to the entity's ONE workspace, not the next hop up a rank chain — so only
   * the first element is comparable; the rest of the path is the resolver's
   * own business (it re-derives the same graph recursively, the fence does
   * not need to and should not restate it).
   *
   * `bb_workspace`, `bb_project` and `bb_team` are excluded: the
   * resolver has no chain for the first (D2, its routes carry no workspace
   * segment) and the fence answers for the other two through its own
   * `resolveChain()` branches rather than through `HOP_FIELDS` — both are
   * covered by their own tests below instead of this generic loop.
   *
   * `bb_term` is excluded from the resolver side: it has no product
   * route — the resolver answering "no chain" is correct, not drift.
   * `bb_machine` has no fence hop (account-owned). `bb_conductor` now
   * has a product chain (`project_id` → `group_id` → `workspace_id`) and is
   * compared here.
   */
  public function testFenceHopsAreTheResolversFirstChainHop(): void {
    $hops = array_diff_key(
      BbRankEntityFence::HOP_FIELDS,
      array_flip(['bb_term']),
    );
    $chains = self::resolverChains();

    foreach ($hops as $entity_type_id => $field) {
      self::assertArrayHasKey(
        $entity_type_id,
        $chains,
        "$entity_type_id has a fence hop but WorkspaceResolver declares no chain for it.",
      );
      self::assertSame(
        $field,
        $chains[$entity_type_id][0] ?? NULL,
        "$entity_type_id: the fence's hop and the resolver's first chain hop must be the same edge.",
      );
    }
  }

  /**
   * The multi-valued `bb_project` to `teams` edge (D5) is the same edge.
   *
   * The three places that must read it: the fence's own `bb_project`
   * branch, the constraint's anchor, and the read-scope's project-of-teams
   * condition.
   */
  public function testProjectTeamsEdgeAgreesAcrossFenceConstraintAndReadScope(): void {
    self::assertSame(
      self::constant(BbWorkspaceReadScope::class, 'PROJECT_TEAMS_FIELD'),
      self::constant(BbRankEntityFence::class, 'PROJECT_TEAMS_FIELD'),
      'The read-scope and the fence must read the teams edge off the same field name.',
    );
    self::assertSame(
      self::constant(BbRankEntityFence::class, 'PROJECT_TEAMS_FIELD'),
      self::constant(BbGroupScopeConstraint::class, 'ANCHORS')['bb_project'] ?? NULL,
      "BB-462 D6: the project's create anchor must be the SAME edge D5 added to the fence and the read-scope, or the anchor move is a no-op (F1).",
    );
  }

  /**
   * The single-valued `bb_project` → workspace edge agrees in three places.
   *
   * The resolver's full chain (`group_id`, `workspace_id`) is the ordered
   * path; its first hop is the comparable fact, exactly as for the other
   * types above.
   */
  public function testProjectWorkspaceEdgeAgreesAcrossFenceAndResolver(): void {
    self::assertSame(
      BbRankEntityFence::PROJECT_WORKSPACE_FIELD,
      self::resolverChains()['bb_project'][0] ?? NULL,
      "The fence's project→workspace hop and the resolver's first project chain hop must be the same edge.",
    );
    self::assertStringStartsWith(
      BbRankEntityFence::PROJECT_WORKSPACE_FIELD . '.entity.',
      BbWorkspaceReadScope::PROJECT_WORKSPACE_CONDITION,
      'The read-scope\'s project-workspace query condition must chain through the same field the fence and the resolver use.',
    );
  }

  /**
   * Creating a team is anchored on its workspace, the one type that is (F1).
   *
   * `BbRankEntityFence::HOP_FIELDS['bb_team']` deliberately still reads
   * `workspace_id` — that entry serves every OTHER type's hop TO a team
   * (`bb_ticket.team`, once BB-420 adds it, would hop here), not a
   * team's OWN chain, which `resolveChain()` special-cases exactly because
   * `HOP_FIELDS` cannot express "include $entity too" (see that method's own
   * comment). This test pins the one fact `HOP_FIELDS` cannot: the anchor
   * `BbGroupScopeConstraint` fences `create bb_project` against is a
   * team's OWN row.
   */
  public function testGroupScopeConstraintAnchorsTeamCreationOnWorkspace(): void {
    self::assertSame(
      'workspace_id',
      self::constant(BbGroupScopeConstraint::class, 'ANCHORS')['bb_team'] ?? NULL,
      'Creating a TEAM (not a project) is still anchored on the workspace — only guarded by BbGroupScopeConstraint::ANCHORS, since a team owns no rank of its own that could grant create bb_team.',
    );
  }

  /**
   * Every bakers.build type the read-scope subscriber names is a type the fence knows.
   *
   * The rule map names exactly the types a per-field query-access rule
   * applies to; every bakers.build type among them must be a type the fence also
   * knows about (either through `HOP_FIELDS` or one of its own special
   * cases), or the read-scope narrows a type the fence would answer
   * differently for on the SAME collection.
   *
   * `user` and `og_membership` are excluded: neither is a `bb_*` type, so
   * both are out of `bb_core_entity_access()`'s own routing
   * (`str_starts_with($entity_type_id, 'bb_')`) — the fence never claims to
   * answer for either. `user` narrows the PEOPLE set (D3's third question)
   * and `og_membership` narrows the membership-listing rule BB-391 added;
   * neither is a concern the fence's tenancy chain covers.
   */
  public function testReadScopeSubscriberRuleTypesAreAllKnownToTheFence(): void {
    $rule_types = array_diff(array_keys(self::readScopeRules()), ['user', 'og_membership']);
    $fence_types = array_merge(
      array_keys(BbRankEntityFence::HOP_FIELDS),
      ['bb_workspace', 'bb_project', 'bb_team'],
    );

    foreach ($rule_types as $entity_type_id) {
      self::assertContains(
        $entity_type_id,
        $fence_types,
        "$entity_type_id has a read-scope rule but the fence declares no chain for it at all — a read/write split the next edge could silently introduce.",
      );
    }
  }

  /**
   * The ticket template is anchored on its project, else its workspace.
   *
   * Exactly one of the two is set on a template, so every source reads
   * `project_id` first and falls back to `workspace_id`.
   */
  public function testTicketTemplateIsAnchoredOnProjectOrWorkspaceInAllSources(): void {
    $type = 'bb_ticket_template';
    self::assertSame('project_id', self::constant(BbRankEntityFence::class, 'HOP_FIELDS')[$type] ?? NULL);
    self::assertSame('project_id', self::constant(BbGroupScopeConstraint::class, 'ANCHORS')[$type] ?? NULL);
    self::assertSame('project_id', self::resolverChains()[$type][0] ?? NULL);
    self::assertSame('workspace_id', self::constant(BbRankEntityFence::class, 'ALTERNATE_HOP_FIELDS')[$type] ?? NULL);
    self::assertSame('workspace_id', self::constant(BbGroupScopeConstraint::class, 'ALTERNATE_ANCHORS')[$type] ?? NULL);
    self::assertSame(['workspace_id'], self::constant(WorkspaceResolver::class, 'ALTERNATE_CHAINS')[$type] ?? NULL);
    self::assertSame(
      [['project_id', 'projects'], ['workspace_id', 'template_workspaces']],
      self::readScopeRules()[$type]['terms'] ?? NULL,
      'A template is readable through its project, or through a workspace where the account may view templates.',
    );
    self::assertSame('OR', self::readScopeRules()[$type]['conjunction'] ?? NULL);
  }

  /**
   * The ticket trigger is anchored on its own workspace, not a dotted rule.
   *
   * Its target is a bundle field that differs per bundle, so the trigger
   * carries `workspace_id` itself. Its query handler materializes readable
   * target ids, so the subscriber must not grow a rule for this type.
   */
  public function testTicketTriggerIsAnchoredOnItsWorkspace(): void {
    $type = 'bb_ticket_trigger';
    self::assertSame('workspace_id', self::constant(BbRankEntityFence::class, 'HOP_FIELDS')[$type] ?? NULL);
    self::assertSame('workspace_id', self::constant(BbGroupScopeConstraint::class, 'ANCHORS')[$type] ?? NULL);
    self::assertSame(['workspace_id'], self::resolverChains()[$type] ?? NULL);
    self::assertArrayNotHasKey($type, self::readScopeRules());
  }

  /**
   * Reads a public class constant through `constant()`, mixed-typed on purpose.
   *
   * A direct `Class::CONST` reference resolves to a phpstan LITERAL type, so
   * comparing two of them with `assertSame()` is flagged as "always true" —
   * true only because phpstan can already see today's values match; the
   * whole point of this test is to catch the day a human edits one side and
   * not the other. Reading through `constant()` returns `mixed`, which is
   * what this comparison actually is: a RUNTIME fact, not a compile-time one.
   *
   * @param class-string $class
   *   The class the constant is declared on.
   * @param string $name
   *   The constant's name.
   *
   * @return mixed
   *   The constant's value.
   */
  private static function constant(string $class, string $name): mixed {
    return constant("$class::$name");
  }

  /**
   * Reads `WorkspaceResolver::CHAINS` by reflection.
   *
   * Private on the class on purpose (its own docblock: request-scoped
   * traversal, not a public contract) — this test needs the VALUE, not a
   * second public surface added only so a test could read it.
   *
   * @return array<string, array<string>>
   *   The chains, keyed by entity type id.
   */
  private static function resolverChains(): array {
    $reflection = new \ReflectionClass(WorkspaceResolver::class);
    return $reflection->getConstant('CHAINS');
  }

  /**
   * Reads `WorkspaceReadScopeSubscriber::rules()` by reflection.
   *
   * Private static on the class for the same reason `CHAINS` is private: it
   * is the subscriber's own working data, not a contract other classes are
   * meant to call.
   *
   * @return array<string, array{conjunction: string, terms: array<array{string, string}>}>
   *   The rule map, keyed by entity type id.
   */
  private static function readScopeRules(): array {
    $reflection = new \ReflectionClass(WorkspaceReadScopeSubscriber::class);
    $method = $reflection->getMethod('rules');
    $method->setAccessible(TRUE);
    return $method->invoke(NULL);
  }

}
