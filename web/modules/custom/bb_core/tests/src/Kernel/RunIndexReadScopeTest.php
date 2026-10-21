<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Plugin\search_api\processor\BbReadScope;
use Drupal\search_api\Entity\Index;
use Drupal\search_api\Query\ResultSetInterface;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Yaml\Yaml;

/**
 * A run from another workspace never appears in the `bb_runs` index.
 *
 * BB-454 acceptance criterion 25's missing second conjunct: the index
 * declares `bb_read_scope`, but nothing asserted a cross-workspace run was
 * actually excluded — `WebUiSitemapStructureTest` cannot see it, because it
 * stubs both Runs displays on `users_field_data` rather than the real
 * `search_api` index (its own docblock states this). Mirrors
 * `TicketIndexReadScopeTest`, the house pattern for this exact property on
 * the sibling `bb_tickets` index.
 *
 * One review-time finding this test is built to prove absent rather than
 * assume: `BbReadScope::supportsIndex()` used to check ONLY
 * `entity:bb_ticket`, and `Index::preSave()` calls `supportsIndex()` on
 * every ENABLED processor and silently `removeProcessor()`s one that answers
 * FALSE — so `bb_read_scope` was stripped from `bb_runs` the moment
 * anything saved it, `processor_settings` in config notwithstanding.
 * Confirmed against the real recipe-test instance before the fix: saving the
 * loaded index made `bb_read_scope` vanish from `getProcessors()`.
 */
#[Group('bb_core')]
final class RunIndexReadScopeTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'search_api', 'search_api_db', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // Saving a server runs search_api's ServerTaskManager, which queries the
    // search_api_task entity.
    $this->installEntitySchema('search_api_task');
    // The tracker's own table: without it nothing is ever tracked, and
    // indexItems() answers 0 with no error at all.
    $this->installSchema('search_api', ['search_api_item']);
    $this->installReadScopeEnvironment();
    $this->installConfig(['search_api']);
    // `search_api.server.bb_db` ships in `bb_core/config/optional`, so the
    // sweep below supplies it — but `search_api.index.bb_runs` does NOT (it
    // ships only in `config/sync/` and the recipe's own `config/`, per the
    // confirmed plan §5), so it is loaded directly from the recipe path
    // instead, mirroring `RunsNavigationViewsTrait`.
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $index_values = Yaml::parseFile(dirname(DRUPAL_ROOT) . '/recipes/bakers/config/search_api.index.bb_runs.yml');
    unset($index_values['uuid'], $index_values['_core']);
    Index::create($index_values)->save();
  }

  /**
   * An account of no workspace reads no run of any workspace.
   */
  public function testAnOutsiderSeesNothingOfAnotherWorkspace(): void {
    [$mine, $theirs] = $this->seedTwoWorkspacesWithOneRunEach();

    $outsider = $this->createAccount('outsider', ['view bb_run']);

    $results = $this->queryAs($outsider);

    self::assertSame(
      0,
      (int) $results->getResultCount(),
      'An account with no membership read runs it has no scope for.',
    );
    unset($mine, $theirs);
  }

  /**
   * A member reads their own workspace's run and not the other's.
   */
  public function testMemberSeesOnlyTheirOwnProjects(): void {
    [$mine, $theirs] = $this->seedTwoWorkspacesWithOneRunEach();

    $results = $this->queryAs($mine['account']);

    // An item id is `entity:bb_run/<id>:<langcode>`.
    $ids = array_map(
      static fn (string $item): string => explode(':', explode('/', $item)[1] ?? '')[0],
      array_keys($results->getResultItems()),
    );

    self::assertContains((string) $mine['run']->id(), $ids);
    self::assertNotContains(
      (string) $theirs['run']->id(),
      $ids,
      'A run of another workspace leaked into the result set.',
    );
  }

  /**
   * The processor supports the runs index, or the fix above regressed.
   *
   * A behaviour check rather than a config-key check (criterion 25's own
   * complaint about the coding handoff): `getProcessors()` before and after a
   * save must agree, because that agreement is exactly what
   * `Index::preSave()`'s silent `removeProcessor()` breaks when
   * `supportsIndex()` answers FALSE.
   */
  public function testTheProcessorSurvivesSavingTheRunsIndex(): void {
    $index = Index::load('bb_runs');
    self::assertNotNull($index, 'The bb_runs index is missing.');
    self::assertArrayHasKey(
      'bb_read_scope',
      $index->getProcessors(),
      'bb_read_scope must be enabled on the runs index before save.',
    );

    $index->save();

    $reloaded = Index::load('bb_runs');
    self::assertNotNull($reloaded);
    self::assertArrayHasKey(
      'bb_read_scope',
      $reloaded->getProcessors(),
      'bb_read_scope must still be enabled after a save — Index::preSave() strips any processor whose supportsIndex() answers FALSE.',
    );
  }

  /**
   * The processor now claims BOTH admitted datasources.
   */
  public function testItSupportsBothTheTicketsAndTheRunsIndex(): void {
    self::assertTrue(
      BbReadScope::supportsIndex(Index::load('bb_tickets')),
      'bb_read_scope must still support the tickets index.',
    );
    self::assertTrue(
      BbReadScope::supportsIndex(Index::load('bb_runs')),
      'bb_read_scope must support the runs index.',
    );
  }

  /**
   * Two workspaces, a project, a ticket and a run in each, one member of A.
   *
   * @return array<int, array{account: \Drupal\user\UserInterface|null, run: \Drupal\Core\Entity\ContentEntityInterface}>
   *   The two worlds.
   */
  private function seedTwoWorkspacesWithOneRunEach(): array {
    $this->buildTwoWorkspaceWorld();

    // Side A's account is a member of A's workspace AND of A's team: a bare
    // workspace membership without a see-all role resolves to no projects, so
    // the positive half would otherwise measure the fixture, not the rule.
    //
    // THE SECOND MEMBERSHIP IS THE TEAM, not the project. BB-462 D4/D7 made
    // project visibility follow team membership, and direct project OG
    // membership no longer exists — `bb_project-bb_project-member` is
    // deleted with the rest of the project role set. `TicketIndexReadScopeTest`
    // carries the same fixture for the same reason.
    $account = $this->createAccount('scoped-a', ['view bb_run']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);

    $index = Index::load('bb_runs');
    self::assertNotNull($index, 'The bb_runs index is missing.');
    $indexed = $index->indexItems();
    self::assertSame(
      2,
      $indexed,
      'Both runs must be in the index, or an empty answer proves nothing.',
    );

    return [
      ['account' => $account, 'run' => $this->fixture('a', 'bb_run')],
      ['account' => $this->member('b'), 'run' => $this->fixture('b', 'bb_run')],
    ];
  }

  /**
   * Runs the index's own query as the given account.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to act as.
   *
   * @return \Drupal\search_api\Query\ResultSetInterface
   *   The result set.
   */
  private function queryAs(AccountInterface $account): ResultSetInterface {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account);
    try {
      $index = Index::load('bb_runs');
      self::assertNotNull($index, 'The bb_runs index is missing.');
      return $index->query()->execute();
    }
    finally {
      $switcher->switchBack();
    }
  }

}
