<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Session\AccountInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Plugin\search_api\processor\BbReadScope;
use Drupal\search_api\Entity\Index;
use Drupal\search_api\Query\ResultSetInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * A Search API query answers only within the account's read scope.
 *
 * ViewsQueryAlter::alter() is typed on the SQL query plugin, so the
 * entity.query_access rule never reaches a Search API query. Without the
 * processor this test guards, the index answers every workspace's tickets to
 * everyone — a disclosure rather than a malfunction, which is why the
 * assertion is written from the OUTSIDER's side.
 */
#[Group('bb_core')]
final class TicketIndexReadScopeTest extends KernelTestBase {

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
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
  }

  /**
   * An account of no workspace reads no ticket of any workspace.
   */
  public function testAnOutsiderSeesNothingOfAnotherWorkspace(): void {
    [$mine, $theirs] = $this->seedTwoWorkspacesWithOneTicketEach();

    $outsider = $this->createAccount('outsider', ['view bb_ticket']);

    $results = $this->queryAs($outsider);

    // Cast, because search_api_db answers the count as the string the database
    // returned. The value is still compared identically — `assertSame(0, …)`
    // on an int is exactly as strict as the plan intended, and `assertEquals`
    // would have accepted '' and NULL as well.
    self::assertSame(
      0,
      (int) $results->getResultCount(),
      'An account with no membership read tickets it has no scope for.',
    );
    unset($mine, $theirs);
  }

  /**
   * A member reads their own workspace's ticket and not the other's.
   */
  public function testMemberSeesOnlyTheirOwnProjects(): void {
    [$mine, $theirs] = $this->seedTwoWorkspacesWithOneTicketEach();

    $results = $this->queryAs($mine['account']);

    // An item id is `entity:bb_ticket/<id>:<langcode>`, so the entity id is
    // the part after the slash and before the colon. The plan's version
    // stopped at the slash and compared `1:en` against `1`.
    $ids = array_map(
      static fn (string $item): string => explode(':', explode('/', $item)[1] ?? '')[0],
      array_keys($results->getResultItems()),
    );

    self::assertContains((string) $mine['ticket']->id(), $ids);
    self::assertNotContains(
      (string) $theirs['ticket']->id(),
      $ids,
      'A ticket of another workspace leaked into the result set.',
    );
  }

  /**
   * The processor answers FALSE for an index it has nothing to say about.
   *
   * IT IS NOT A HYPOTHETICAL, and the failure mode is not "the wrong answer"
   * but a fatal. `Index::getDatasource()` THROWS `SearchApiException` when the
   * id is absent — only `isValidDatasource()` answers a boolean — and
   * `supportsIndex()` is asked of every processor CLASS on the index whose
   * processors are being listed (`IndexProcessorsForm::buildForm()` calls it
   * over the full plugin definition list, `Index::preSave()` over the enabled
   * ones). So the moment this installation grows a second Search API index of
   * any other entity type, opening its Processors tab throws — an
   * unrecoverable 500 on a screen that has nothing to do with tickets, caused
   * by a plugin that should simply have said "not mine".
   *
   * The index is built and NOT saved: `supportsIndex()` is static and reads
   * only the datasource settings, so saving would add a tracker, a server and
   * a task queue to a case about one boolean.
   */
  public function testItDoesNotSupportAnIndexOfAnotherEntityType(): void {
    $other = Index::create([
      'id' => 'other_things',
      'name' => 'Other things',
      'datasource_settings' => ['entity:user' => []],
    ]);

    self::assertFalse(
      BbReadScope::supportsIndex($other),
      'The processor claimed an index that carries no bb_ticket datasource.',
    );
  }

  /**
   * Two workspaces, a project and a ticket in each, one member of the first.
   *
   * @return array<int, array{account: \Drupal\user\UserInterface|null, ticket: \Drupal\Core\Entity\ContentEntityInterface}>
   *   The two worlds.
   */
  private function seedTwoWorkspacesWithOneTicketEach(): array {
    // WorkspaceReadScopeTestTrait already builds exactly this world, and it is
    // the fixture WorkspaceReadScopeSubscriber's own Kernel coverage asserts
    // against. Rebuilding it here would be a second fixture that could drift
    // from the rule under test.
    $this->buildTwoWorkspaceWorld();

    // Side A's account is a member of A's workspace AND of A's project: a bare
    // workspace membership without a see-all role resolves to no projects, so
    // the positive half would otherwise measure the fixture, not the rule.
    $account = $this->createAccount('scoped-a', ['view bb_ticket']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);

    $index = Index::load('bb_tickets');
    self::assertNotNull($index, 'The bb_tickets index is missing.');
    $indexed = $index->indexItems();
    self::assertSame(
      2,
      $indexed,
      'Both tickets must be in the index, or an empty answer proves nothing.',
    );

    return [
      ['account' => $account, 'ticket' => $this->fixture('a', 'bb_ticket')],
      ['account' => $this->member('b'), 'ticket' => $this->fixture('b', 'bb_ticket')],
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
      $index = Index::load('bb_tickets');
      self::assertNotNull($index, 'The bb_tickets index is missing.');
      return $index->query()->execute();
    }
    finally {
      $switcher->switchBack();
    }
  }

}
