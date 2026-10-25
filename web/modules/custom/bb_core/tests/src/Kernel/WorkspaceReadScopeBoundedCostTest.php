<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Database\Database;
use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The read scope costs a fixed number of queries, whatever the row count (V4).
 *
 * AC 4, asserted by counting queries rather than by inspection — and asserted
 * as an exact number rather than a bound, so a changed cost forces a decision
 * instead of passing quietly.
 *
 * The number is the one the code actually issues, measured rather than assumed.
 * Spec D3 counts three: one og_membership query serving both OG entry points
 * (Fact 11), one project resolution, one people resolution. The measured figure
 * is higher, and the reason is recorded on the constant: Fact 11 counts OG's
 * ENTITY query, while MembershipManager::getMemberships() also loads the
 * membership entities it just found, and a fieldable entity load reads its
 * dedicated `roles` table too. That is a round-trip count, not a second
 * resolution, and it is bounded by the account's own membership count — never
 * by the number of rows any collection returns, which is what the criterion is
 * about.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceReadScopeBoundedCostTest extends KernelTestBase {

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
   * The exact number of resolution queries one request issues.
   *
   * Measured, not assumed, and itemised so a change in the figure can be read
   * against a cause:
   *
   * 1. OG's og_membership ENTITY query — the one Fact 11 counts, shared by both
   *    OG entry points through cache.static.
   * 2. the load of the memberships that query returned, from the base table;
   * 3. their dedicated `roles` table;
   * 4. their dedicated `og_membership_request` table — the configurable field
   *    og ships in its own config/install;
   * 5. the bb_project resolution of the see-all rule (D4);
   * 6. the og_membership aggregate that resolves the people set.
   *
   * Rows 2 to 4 are OG loading the entities it just found, so the three logical
   * resolutions D3 names cost six round trips. That figure grows with the
   * number of FIELDS on og_membership and with nothing else — in particular not
   * with the number of rows any collection returns, which is what the criterion
   * is about and what the first case below asserts directly.
   */
  private const RESOLUTION_QUERIES = 6;

  /**
   * The log key used for every measurement.
   */
  private const LOG_KEY = 'bakers318_bounded_cost';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
  }

  /**
   * One collection query costs the same on a one-row and a many-row dataset.
   *
   * This is the criterion in its own words: the cost must be independent of the
   * number of rows returned, which an `IN`-list filter satisfies and a per-row
   * access check would not.
   */
  public function testTheCostIsIndependentOfTheRowCount(): void {
    $small = $this->createScopedAccount('cost-small');
    $small_count = $this->measure(
      fn (): array => $this->queryIdsAs('bb_ticket', $small),
    );

    // Grow the dataset by an order of magnitude inside the account's own scope,
    // so the extra rows are actually returned rather than filtered away.
    for ($i = 0; $i < 30; $i++) {
      $this->createEntity('bb_ticket', [
        'identifier' => 'T-BULK-' . $i,
        'title' => 'bulk-' . $i,
        'workflow' => 'bb_work',
        'project_id' => $this->fixture('a', 'bb_project')->id(),
      ]);
    }

    $large = $this->createScopedAccount('cost-large');
    $large_count = $this->measure(
      fn (): array => $this->queryIdsAs('bb_ticket', $large),
    );

    self::assertGreaterThan(
      30,
      count($this->queryIdsAs('bb_ticket', $large)),
      'The large dataset really is large, so the comparison means something.',
    );
    self::assertSame(self::RESOLUTION_QUERIES, $small_count);
    self::assertSame(
      $small_count,
      $large_count,
      'The read scope resolves ids, so its cost cannot grow with the rows.',
    );
  }

  /**
   * Two entity types in one request do not double the resolution.
   *
   * The memoisation in BbWorkspaceReadScope is what makes ten entity types
   * cost one resolution, and it is the only reason the per-type event
   * registration is affordable at all.
   */
  public function testTwoEntityTypesInOneRequestResolveOnce(): void {
    $account = $this->createScopedAccount('cost-two-types');

    $count = $this->measure(function () use ($account): void {
      $this->queryIdsAs('bb_ticket', $account);
      $this->queryIdsAs('bb_environment', $account);
    });

    self::assertSame(self::RESOLUTION_QUERIES, $count);
  }

  /**
   * A second identical request on the same account resolves nothing again.
   */
  public function testTheSecondQueryInOneRequestResolvesNothing(): void {
    $account = $this->createScopedAccount('cost-repeat');
    $this->queryIdsAs('bb_ticket', $account);

    $count = $this->measure(
      fn (): array => $this->queryIdsAs('bb_ticket', $account),
    );

    self::assertSame(0, $count, 'The resolved sets are memoised per account.');
  }

  /**
   * Creates an account that resolves all three sets non-trivially.
   *
   * A workspace `admin` membership, so the see-all project resolution runs; the
   * cheaper cases only issue a subset of the queries and would therefore
   * measure a different, smaller number for the wrong reason.
   *
   * @param string $name
   *   The account name.
   *
   * @return \Drupal\Core\Session\AccountInterface
   *   The account.
   */
  private function createScopedAccount(string $name): AccountInterface {
    $account = $this->createAccount($name, [
      'view bb_ticket', 'view bb_environment',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['lead']);
    return $account;
  }

  /**
   * Counts the membership-resolution queries a callable issues.
   *
   * Classified by table rather than by position, and the callable deliberately
   * only ever queries bb_ticket and bb_environment — neither of whose
   * collection SQL mentions og_membership or bb_project, so no collection
   * query can be miscounted as a resolution.
   *
   * @param callable $operation
   *   The operation to measure.
   *
   * @return int
   *   The number of resolution queries issued.
   */
  private function measure(callable $operation): int {
    Database::startLog(self::LOG_KEY);
    $operation();
    $log = Database::getLog(self::LOG_KEY);

    $count = 0;
    foreach ($log as $entry) {
      $sql = (string) ($entry['query'] ?? '');
      if (str_contains($sql, 'og_membership') || str_contains($sql, 'bb_project')) {
        $count++;
      }
    }
    return $count;
  }

}
