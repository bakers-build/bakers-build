<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Access\BbOgMembershipAccessControlHandler;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A membership is readable inside the read scope and nowhere else (BB-391).
 *
 * `og_membership` is the model's central relation — every rank comes from one —
 * and until now it was readable only on site-wide `administer organic groups`
 * or an OG `administer group` / `manage members` grant
 * (`OgMembershipAccessControlHandler::checkAccess()`). The `bb:session`
 * umbrella names none of those, so a machine identity's collection read
 * answered HTTP 200 with `data: []` and a `meta.omitted` block listing every
 * row, and the `bakers ui` Teams tab reported `MEMBERS 0` for a crew of three.
 * Measured at BB-391; a count of zero is worse than the `—` the client reserves
 * for "uncounted", because only one of the two admits it does not know.
 *
 * The fix is deliberately NOT `administer organic groups`: that is site-wide
 * and
 * would rebuild exactly the tenant-blindness the umbrella design avoids. It is
 * also not a computed `members` field on `bb_team` — such a field cannot
 * carry
 * the rank, the `state`, or the workspace- and project-level rows, and it would
 * drift from the relation it mirrors.
 *
 * So capability and rows are split the way the rest of bakers.build splits
 * them:
 *
 * - the PERMISSION `view bakers memberships` decides that the operation exists
 *   at all, and it grants unconditionally — a child scope always does;
 * - the ROWS come from the read scope, twice over: a `query_access` rule for
 *   the collection (so the rows are FILTERED, and an empty crew stops looking
 *   like an unreadable one) and this module's own access control handler for
 *   the single row (so a filtered collection cannot be walked around by uuid).
 *
 * Both halves are asserted here, and so is the negative half of each: the
 * permission alone must reach nothing, and the scope alone must grant nothing.
 * Without those two, the rule could be a pass-through and every other assertion
 * would still be green.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MembershipReadScopeTest extends KernelTestBase {

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
   * The crew inside the read scope is listed; the one outside it is not.
   *
   * The positive half is asserted FIRST and on purpose. A rule that falsified
   * every query would satisfy "no foreign rows" perfectly, and the symptom is
   * the one BB-318 R2 warns about: HTTP 200, zero rows, nothing logged.
   */
  public function testTheCrewInsideTheReadScopeIsReadAndTheOneOutsideIsNot(): void {
    $reader = $this->createAccount('crew-reader', [
      BbOgMembershipAccessControlHandler::VIEW_PERMISSION,
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    // A THIRD person's membership, never the reader's own: an assertion about a
    // row the reader owns would pass on the owner grant alone and say nothing
    // about the scope.
    $mate = $this->createAccount('crew-mate');
    $mine = $this->addMembership($this->fixture('a', 'bb_team'), $mate);
    $theirs = $this->addMembership($this->fixture('b', 'bb_team'), $mate);

    $visible = $this->queryIdsAs('og_membership', $reader);

    self::assertContains(
      (int) $mine->id(),
      $visible,
      'a crew inside the reader\'s workspace must be listed, or MEMBERS counts 0 '
      . 'for a crew that has members',
    );
    self::assertNotContains((int) $theirs->id(), $visible);
    // And the same answer for the single row, because a filtered collection
    // that can be walked around by asking for a uuid is not a bound.
    self::assertTrue($mine->access('view', $reader));
    self::assertFalse($theirs->access('view', $reader));
  }

  /**
   * A withheld row is FILTERED OUT of the query, not returned and then denied.
   *
   * This is the distinction the whole change exists for. JSON:API runs the
   * collection query first and checks each returned row afterwards, so a row
   * that
   * survives the query and fails the row check lands in `meta.omitted` — HTTP
   * 200
   * with an empty `data`, which a counting client reads as zero. Only a row the
   * QUERY never returned is invisible without saying so.
   */
  public function testTheForeignCrewNeverReachesTheRowCheckAtAll(): void {
    $reader = $this->createAccount('crew-reader-filtered', [
      BbOgMembershipAccessControlHandler::VIEW_PERMISSION,
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    $mate = $this->createAccount('crew-mate-filtered');
    $theirs = $this->addMembership($this->fixture('b', 'bb_team'), $mate);

    self::assertNotContains(
      (int) $theirs->id(),
      $this->queryIdsAs('og_membership', $reader),
      'the foreign row must be gone from the QUERY: a row the query returns and '
      . 'the row check then denies is a meta.omitted entry, which is exactly the '
      . 'signal this ticket removes',
    );
  }

  /**
   * The group TYPE is part of the bound, not only the group id.
   *
   * `og_membership` anchors a row on the PAIR (`entity_type`, `entity_id`), and
   * `entity_id` is a plain STRING base field carrying the group's numeric id
   * (BB-321 Fact 12). Every group type has its own id sequence, so a single
   * `entity_id IN (…)` term over the union of the workspace, project and team
   * sets lets a FOREIGN team be read whenever its id happens to match an
   * in-scope project's — which is not exotic, because both sequences start at
   * 1.
   *
   * The fixture makes the collision real rather than hypothetical, and asserts
   * it, so the test cannot quietly stop being sharp when the world grows a row.
   */
  public function testTheGroupTypeDiscriminatorKeepsCollidingForeignCrewsOut(): void {
    // BB-462 D7: bb_project is no longer an OG group, so the colliding
    // pair is now a foreign workspace and an in-scope team — the two group
    // types the discriminator still has to keep apart.
    $foreign_workspace = $this->createEntity('bb_workspace', [
      'name' => 'workspace-c',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $own_team = $this->createEntity('bb_team', [
      'name' => 'team-a-second',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
    ]);
    self::assertSame(
      (int) $foreign_workspace->id(),
      (int) $own_team->id(),
      'the fixture must really collide, or this test proves nothing',
    );

    $reader = $this->createAccount('collision-reader', [
      BbOgMembershipAccessControlHandler::VIEW_PERMISSION,
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    $mate = $this->createAccount('collision-mate');
    $foreign = $this->addMembership($foreign_workspace, $mate);
    $own = $this->addMembership($own_team, $mate);

    $visible = $this->queryIdsAs('og_membership', $reader);

    self::assertContains((int) $own->id(), $visible, 'the reader\'s own team crew is readable');
    self::assertNotContains(
      (int) $foreign->id(),
      $visible,
      'a workspace the reader does not belong to must stay unreadable even when '
      . 'its id equals an in-scope team\'s',
    );
    self::assertFalse($foreign->access('view', $reader));
  }

  /**
   * The permission alone reaches no row — it is not the row gate.
   *
   * A child scope grants its permission unconditionally, which is the design:
   * the SCOPE decides which operations exist, the RANK decides which rows they
   * reach. So an identity holding the permission and no membership must read
   * nothing, and this is the assertion that says the two layers are really two.
   */
  public function testThePermissionAloneReachesNoRow(): void {
    $rankless = $this->createAccount('membership-rankless', [
      BbOgMembershipAccessControlHandler::VIEW_PERMISSION,
    ]);
    $mate = $this->createAccount('rankless-mate');
    $row = $this->addMembership($this->fixture('a', 'bb_team'), $mate);

    self::assertSame([], $this->queryIdsAs('og_membership', $rankless));
    self::assertFalse($row->access('view', $rankless));
  }

  /**
   * The scope alone grants nothing either — the permission is still required.
   *
   * The mirror of the case above. Without it the handler could ignore the
   * permission entirely and every assertion here would still pass, which would
   * make the child scope decorative and the ceiling a lie.
   */
  public function testTheScopeAloneGrantsNothing(): void {
    $reader = $this->createAccount('membership-unpermitted');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    $mate = $this->createAccount('unpermitted-mate');
    $row = $this->addMembership($this->fixture('a', 'bb_team'), $mate);

    self::assertFalse(
      $row->access('view', $reader),
      'the membership read is a granted operation, not a free one',
    );
  }

  /**
   * An account always reads its OWN membership, whatever the group.
   *
   * The owner grant, and it is load-bearing twice. It keeps a person able to
   * see
   * the row that grants them their own rank even when the group is outside
   * their
   * read scope — a team membership without the accompanying workspace one is
   * expressible — and it keeps every INTERNAL `getMembership($group, $self)`
   * lookup answering, which is how OG resolves a rank at all.
   */
  public function testEveryAccountAlwaysReadsItsOwnMembership(): void {
    $reader = $this->createAccount('own-row-reader', [
      BbOgMembershipAccessControlHandler::VIEW_PERMISSION,
    ]);
    // A team of workspace B and NO membership in B: the group is outside the
    // reader's read scope by every rule except the owner grant.
    $own = $this->addMembership($this->fixture('b', 'bb_team'), $reader);

    self::assertContains((int) $own->id(), $this->queryIdsAs('og_membership', $reader));
    self::assertTrue($own->access('view', $reader));
  }

  /**
   * Only `view` is widened — membership EDITING stays OG's, and is BB-320.
   *
   * Asserted per operation rather than for `update` alone, because the handler
   * delegates to OG's and a delegation that forgot to narrow the operation
   * would hand a machine identity the ability to change ranks.
   */
  public function testOnlyTheReadOperationIsWidened(): void {
    $reader = $this->createAccount('write-attempt', [
      BbOgMembershipAccessControlHandler::VIEW_PERMISSION,
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['contributor']);
    $mate = $this->createAccount('write-attempt-mate');
    $row = $this->addMembership($this->fixture('a', 'bb_team'), $mate);

    self::assertTrue($row->access('view', $reader));
    foreach (['update', 'delete'] as $operation) {
      self::assertFalse(
        $row->access($operation, $reader),
        "the read permission must not grant $operation: membership editing is BB-320",
      );
    }
    self::assertFalse(
      $this->container->get('entity_type.manager')
        ->getAccessControlHandler('og_membership')
        ->createAccess('default', $reader),
      'the read permission must not grant create either',
    );
  }

  /**
   * Membership resolution is never filtered by the read scope it feeds.
   *
   * The recursion this rule invites, and the reason it terminates: resolving
   * the read scope RUNS an `og_membership` query, and that query re-enters the
   * very listener that is resolving. It is left unnarrowed rather than
   * falsified — falsifying it would make every account look rankless, which at
   * the call site is indistinguishable from holding no rank.
   *
   * Asserted through the rank layer rather than on the guard itself: an account
   * whose ONLY capability comes from a rank must still hold that rank's
   * permissions while the membership collection is narrowed for it.
   */
  public function testRankResolutionSurvivesTheNarrowing(): void {
    $reader = $this->createAccount('rank-holder', [
      BbOgMembershipAccessControlHandler::VIEW_PERMISSION,
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['contributor']);

    // `view bb_ticket` is carried by the workspace ranks and by no role this
    // account holds, so a TRUE here can only have come through the rank layer —
    // which had to resolve memberships to answer.
    self::assertTrue($reader->hasPermission('view bb_ticket'));
    self::assertNotSame([], $this->queryIdsAs('og_membership', $reader));
  }

  /**
   * A membership written mid-request is not hidden by a memo taken before it.
   *
   * Found by two write-scope tests going red, not predicted. The read scope is
   * memoised per request and deliberately not invalidated, which was harmless
   * while the only thing that resolved it was a bakers.build collection query —
   * by then the request's memberships were written. Narrowing `og_membership`
   * changed that: OG's own upsert asks `getMembership()` FIRST, that lookup now
   * resolves the scope, and the membership then lands behind a memo saying the
   * account belongs to nothing. Every later read in the same request is empty
   * at HTTP 200 with no log line.
   *
   * Asserted through the ORDER, because the order is the bug: the lookup
   * happens
   * before the write, exactly as `Og::getMembership() ??
   * Og::createMembership()` does it.
   */
  public function testMembershipWrittenAfterLookupIsStillInScope(): void {
    $reader = $this->createAccount('late-joiner', [
      BbOgMembershipAccessControlHandler::VIEW_PERMISSION,
    ]);
    $workspace = $this->fixture('a', 'bb_workspace');
    // The account has to BE the current user for its own scope to be the one
    // resolved — which is the situation the two write-scope tests are in, and
    // the situation of every request that joins its own actor to a group.
    $this->container->get('current_user')->setAccount($reader);

    // The lookup OG's upsert does first. It resolves — and would memoise — an
    // empty scope for an account that is about to join.
    self::assertNull(Og::getMembership($workspace, $reader, OgMembershipInterface::ALL_STATES));
    $this->addMembership($workspace, $reader, ['member']);

    $mate = $this->createAccount('late-joiner-mate');
    $row = $this->addMembership($this->fixture('a', 'bb_team'), $mate);

    self::assertContains((int) $row->id(), $this->queryIdsAs('og_membership', $reader));
    self::assertTrue($row->access('view', $reader));
  }

  /**
   * An ANONYMOUS current user leaves the membership query untouched.
   *
   * Not a hole, and not cosmetic. `Og::getMembership()` queries with
   * `accessCheck(TRUE)`, and every drush, install and cron path runs as
   * anonymous while asking about SOMEBODY ELSE's membership — the owner
   * placement in `WorkspaceMembershipHooks::placeGroupOwnerInLead()`, for
   * one.
   * Narrowing those would answer NULL for a membership that exists, and the
   * caller's next step is `Og::createMembership()`, which then aborts with "An
   * OG membership already exists for user ID …".
   *
   * Anonymous holds no membership and no read permission, so every row is
   * denied
   * at the row check regardless; what is skipped here is the ergonomics, not
   * the bound.
   */
  public function testAnonymousInternalLookupsAreNotNarrowed(): void {
    $mate = $this->createAccount('anonymous-lookup-mate');
    $row = $this->addMembership($this->fixture('a', 'bb_team'), $mate);

    $found = Og::getMembership(
      $this->fixture('a', 'bb_team'),
      $mate,
      OgMembershipInterface::ALL_STATES,
    );

    self::assertInstanceOf(OgMembershipInterface::class, $found);
    self::assertSame((int) $row->id(), (int) $found->id());
    // And the row is still not readable: the query was not narrowed, the ROW
    // check is what refuses.
    self::assertFalse($row->access('view', $this->container->get('current_user')->getAccount()));
  }

}
