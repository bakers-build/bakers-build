<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Deploy\OauthConsumerCandidates;
use Drupal\KernelTests\KernelTestBase;
use Drupal\og\OgMembershipInterface;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Which accounts the OAuth bootstrap seeds a consumer for (BB-391 D5).
 *
 * The selector used to be `->condition('roles', 'bb_agent')`. D2 deletes that
 * role, so the selector had to move, and D5 moves it onto workspace membership
 * — the same source BB-359 made the source of capability. That is the whole
 * point: a team member is someone who is IN a workspace, and there is now no
 * second, parallel answer to the question sitting on a site-wide role.
 *
 * Tested through a helper rather than by reading `ensure-oauth.php`, because
 * that file is a `drush php:script` with no class to instantiate and no return
 * value — nothing in the tree could assert on its selection. The consequence of
 * getting this wrong is silent by construction: the script prints a line per
 * consumer it seeds and says nothing at all about an account it never selected,
 * so a selector that matches too little produces a SHORTER success log, not an
 * error. That is why the miss cases below are asserted as explicitly as the
 * hits.
 */
#[Group('bb_core')]
final class OauthConsumerCandidatesTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership',
      'bb_workspace', 'bb_group', 'bb_project',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
  }

  /**
   * An account in a workspace is selected; one outside every workspace is not.
   */
  public function testOnlyWorkspaceMembersAreSelected(): void {
    // Uid 1 is a superuser; consume it so it cannot mask the assertions.
    $this->createUser();
    $workspace = $this->workspace('ws-candidates');

    $member = $this->account('member');
    $this->addMembership($workspace, $member, ['member']);
    $stranger = $this->account('stranger');

    $selected = OauthConsumerCandidates::uids($this->container->get('entity_type.manager'));

    self::assertContains((int) $member->id(), $selected);
    self::assertNotContains(
      (int) $stranger->id(),
      $selected,
      'an account in no workspace is not a team member and gets no consumer',
    );
  }

  /**
   * Every rank counts, not just the one the keytec fixture happens to use.
   *
   * The seed's single existing membership carries `lead`; the eight added for
   * D5 carry `member`. A selector that keyed on a rank would seed one group and
   * silently skip the other, so the property asserted is membership itself.
   */
  public function testEveryRankIsSelected(): void {
    $this->createUser();
    $workspace = $this->workspace('ws-ranks');

    $expected = [];
    // `app` is GONE (BB-462 D9): the machine rank is removed entirely.
    foreach (['lead', 'member', 'contributor', 'guest'] as $rank) {
      $account = $this->account('holder-' . $rank);
      $this->addMembership($workspace, $account, [$rank]);
      $expected[] = (int) $account->id();
    }

    $selected = OauthConsumerCandidates::uids($this->container->get('entity_type.manager'));

    foreach ($expected as $uid) {
      self::assertContains($uid, $selected);
    }
  }

  /**
   * A membership that is not ACTIVE is not a membership for this purpose.
   *
   * `uids()` filters on `state`, and nothing measured it. The state matters
   * because OG writes non-active memberships on paths bakers.build already has:
   * `OgMembershipInterface::STATE_PENDING` is what a request-to-join produces
   * (`recipes/bb_e2e` even ships the `og_membership_request` field storage
   * for it), and `STATE_BLOCKED` is how a member is suspended without deleting
   * the row. Both are accounts that must NOT get a confidential
   * client_credentials consumer bound to them — a pending applicant would be
   * handed a token before anyone approved them, and a blocked member would keep
   * one after being suspended.
   *
   * Both directions are asserted in one test on purpose: the same account is
   * measured active and then non-active, so a fixture that simply failed to
   * create a membership at all cannot produce a passing result.
   */
  public function testNonActiveMembershipIsNotSelected(): void {
    $this->createUser();
    $workspace = $this->workspace('ws-states');
    $account = $this->account('applicant');
    $membership = $this->addMembership($workspace, $account, ['member']);

    self::assertContains(
      (int) $account->id(),
      OauthConsumerCandidates::uids($this->container->get('entity_type.manager')),
      'the control: while the membership is active the account IS selected',
    );

    foreach ([
      OgMembershipInterface::STATE_PENDING,
      OgMembershipInterface::STATE_BLOCKED,
    ] as $state) {
      $membership->setState($state)->save();
      // MembershipManager memoises per (uid, states) in cache.static.
      $this->container->get('cache.static')->deleteAll();

      self::assertNotContains(
        (int) $account->id(),
        OauthConsumerCandidates::uids($this->container->get('entity_type.manager')),
        "a $state membership must not seed a client_credentials consumer",
      );
    }
  }

  /**
   * The superuser is never selected, however it is placed.
   *
   * The old selector could not reach uid 1 unless someone had explicitly given
   * it `bb_agent`. Workspace membership is a much wider net — uid 1 is a
   * plausible member of the default workspace — and a client_credentials
   * consumer bound to the superuser would be a root-privileged token issued by
   * a deploy script, which is a strictly worse posture than the one D5
   * replaces. So it is excluded by construction rather than by convention.
   */
  public function testTheSuperuserIsNeverSelected(): void {
    $root = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $root);
    self::assertSame(1, (int) $root->id());
    $workspace = $this->workspace('ws-root');
    $this->addMembership($workspace, $root, ['lead']);

    self::assertNotContains(
      1,
      OauthConsumerCandidates::uids($this->container->get('entity_type.manager')),
    );
  }

  /**
   * Each account is offered once, however many workspaces it is in.
   *
   * The consumer client_id is derived from the account name, so a duplicated
   * uid would make the script attempt the same client_id twice.
   */
  public function testEachAccountIsOfferedOnce(): void {
    $this->createUser();
    $account = $this->account('multi');
    foreach (['ws-one', 'ws-two', 'ws-three'] as $name) {
      $this->addMembership($this->workspace($name), $account, ['member']);
    }

    $selected = OauthConsumerCandidates::uids($this->container->get('entity_type.manager'));

    self::assertSame(
      [(int) $account->id()],
      array_values(array_filter(
        $selected,
        static fn (int $uid): bool => $uid === (int) $account->id(),
      )),
    );
  }

  /**
   * Creates a saved workspace.
   */
  private function workspace(string $name): ContentEntityInterface {
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => $name]);
    self::assertInstanceOf(ContentEntityInterface::class, $workspace);
    $workspace->save();

    return $workspace;
  }

  /**
   * Creates a saved account with no roles and no memberships.
   */
  private function account(string $name): UserInterface {
    $account = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $account);
    $account->save();

    return $account;
  }

}
