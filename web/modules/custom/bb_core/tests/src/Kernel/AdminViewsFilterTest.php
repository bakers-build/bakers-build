<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTicket;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;

/**
 * The admin listings' exposed filters narrow the result set.
 *
 * AdminViewsConfigTest asserts a filter is DECLARED. This class asserts it
 * WORKS: a declared-but-broken filter passes there and fails an operator,
 * which is the failure mode criterion 1 is written against.
 *
 * ON "EMPTY MEANS ALL". WorkspaceReadScopeSubscriber narrows collection
 * queries on bb_ticket, bb_run and bb_conductor to the account's OG
 * read scope, so "lists all tickets" means all tickets the account may see.
 * A Kernel test runs as the root user, for whom the two coincide; the
 * distinction is stated here so a later reader does not read the narrowing
 * as a bug in these views.
 */
#[Group('bb_core')]
final class AdminViewsFilterTest extends KernelTestBase {

  use ProjectsViewTestTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'better_exposed_filters',
    'views_autocomplete_filters', 'markdown_easy', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('bb_ticket');
    $this->installEntitySchema('bb_run');
    $this->installEntitySchema('bb_conductor');
    $this->installConfig(['bb_core']);
    $this->installShippedView('views.view.bb_tickets');

    // WorkspaceReadScopeSubscriber narrows every bakers.build collection query
    // to the acting account's OG read scope; 'administer bakers' is its
    // documented bypass (used the same way by ConductorProjectMatchTest and
    // others), which is what lets this test be about the exposed filters rather
    // than about building a workspace/project membership chain it does not
    // otherwise need.
    $this->setUpCurrentUser([], ['administer bakers']);

    // Two tickets that differ in exactly the fields the filters read, so a
    // filter that narrows to one of them cannot have done so by accident.
    BbTicket::create([
      'identifier' => 'BB-9001',
      'title' => 'Alpha ticket',
      'workflow' => 'bb_work',
      'state' => 'plan',
    ])->save();
    BbTicket::create([
      'identifier' => 'BB-9002',
      'title' => 'Beta ticket',
      'workflow' => 'bb_work',
      'state' => 'working',
    ])->save();
  }

  /**
   * An empty exposed form returns every row.
   */
  public function testEmptyFormListsEverything(): void {
    self::assertCount(2, $this->identifiersFor([]));
  }

  /**
   * Each filter narrows to the one row that carries its value.
   *
   * @param string $key
   *   The exposed filter identifier, as it appears in a query string.
   * @param string $value
   *   The value to filter on.
   *
   * @dataProvider narrowingFilters
   */
  public function testEachFilterNarrows(string $key, string $value): void {
    self::assertSame(
      ['BB-9001'],
      $this->identifiersFor([$key => $value]),
      "The '$key' filter did not narrow to the expected single row.",
    );
  }

  /**
   * The exposed filters that must each narrow to BB-9001 alone.
   *
   * @return array<string, array{string, string}>
   *   Test cases keyed by a readable name.
   */
  public static function narrowingFilters(): array {
    return [
      'identifier' => ['identifier', 'BB-9001'],
      'title' => ['title', 'Alpha'],
      'state' => ['state', 'plan'],
    ];
  }

  /**
   * Two filters in combination narrow further than either alone.
   */
  public function testFiltersCombine(): void {
    self::assertSame(
      ['BB-9001'],
      $this->identifiersFor(['title' => 'Alpha', 'state' => 'plan']),
    );
    self::assertSame(
      [],
      $this->identifiersFor(['title' => 'Alpha', 'state' => 'working']),
      'A contradictory filter pair returned rows.',
    );
  }

  /**
   * Runs the tickets view with the given exposed input.
   *
   * @param array<string, string> $input
   *   The exposed filter values, keyed by filter identifier.
   *
   * @return array<int, string>
   *   The identifiers of the resulting rows.
   */
  private function identifiersFor(array $input): array {
    $view = Views::getView('bb_tickets');
    self::assertNotNull($view, 'views.view.bb_tickets is not installed.');
    $view->setDisplay('page_1');
    $view->setExposedInput($input);
    $view->preExecute();
    $view->execute();

    $identifiers = [];
    foreach ($view->result as $row) {
      $entity = $row->_entity;
      self::assertInstanceOf(BbTicket::class, $entity, 'A view row carried no bb_ticket entity.');
      $identifiers[] = (string) $entity->get('identifier')->value;
    }
    sort($identifiers);
    return $identifiers;
  }

}
