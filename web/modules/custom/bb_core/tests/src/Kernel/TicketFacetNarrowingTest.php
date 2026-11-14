<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\search_api\Entity\Index;
use Drupal\user\UserInterface;
use Drupal\views\Plugin\views\exposed_form\ExposedFormPluginInterface;
use Drupal\views\ViewExecutable;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;

/**
 * A facet offers only the values that still yield a hit.
 *
 * WHAT WAS BROKEN, AND IT WAS NOT THE NARROWING. The facet data was narrowed
 * correctly all along — `?priority[]=1` really did report `state: spec=1` and
 * every other state at **count 0**. What put the other five back on screen is
 * `min_count: 0`, which `search_api_db`'s `Database::getFacets()` reads as
 * "also SELECT every DISTINCT value of the field, with `count => 0`".
 * An `or` facet then keeps those zero-count terms, because
 * `SearchApiString::build()` drops a zero-count result only for an `and` facet
 * (`if ($result['count'] || $query_operator === 'or')`). So the panel offered
 * six states where one yielded anything, and picking any of the other five
 * produced an empty list.
 *
 * THE `or` OPERATOR IS NOT THE DEFECT AND IS NOT TOUCHED. A facet with
 * `query_operator: or` is excluded from its OWN filter, so its values keep
 * their full counts and only the other active facets narrow it. That lets a
 * reader add a second state to a chosen one; an `and` facet would collapse to
 * the single value already picked and the multi-select would be unusable.
 * `testTheChosenFacetKeepsItsOwnValues` is the guard on that.
 *
 * AN ACTIVE VALUE IS NEVER HIDDEN, and the two ways it can survive are asserted
 * separately because only one of them is contrib's. Where the facet still has
 * results, `SearchApiString::build()` re-adds a chosen value that no longer
 * matches as a count-0 result — before the build processors run, so it is still
 * labelled. Where the facet has NO results at all, contrib never reaches that
 * branch, and `BbOptionPickerWidget` keeps the row itself. Without the second
 * half a chosen filter would vanish from the panel and be dropped, silently, by
 * the next pick of any other facet.
 */
#[Group('bb_core')]
final class TicketFacetNarrowingTest extends KernelTestBase {

  /**
   * The display these assertions render.
   *
   * IT WAS `block_1` UNTIL 2026-09-04. The human deleted the list controller
   * and gave the tickets view its route back, so the view has ONE display that
   * is not `default`: the page display at `_workspace/%bb_workspace/tickets`.
   * A block display that nothing placed went with the controller.
   */
  private const DISPLAY_ID = 'page_1';

  /**
   * The route argument the display is executed with.
   *
   * NOT DECORATION. The page display's path carries a named placeholder, so
   * `ViewExecutable::hasUrl()` is TRUE and `ViewsExposedForm` builds the form
   * action from `$view->getUrl()`. With no arguments Views substitutes `*` for
   * `{bb_workspace}`, the route's slug requirement rejects it, and generating
   * the URL throws `InvalidParameterException`.
   */
  private const WORKSPACE_SLUG = 'bakers';

  use UserCreationTrait;
  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'better_exposed_filters', 'facets', 'facets_exposed_filters',
    // `views_filters_summary` states the chosen facets above the rows
    // (BB-413, 2026-09-04) and the view names it in
    // `dependencies.module`, so the optional config installer refuses the
    // view without it — the symptom is "The tickets view is not installed".
    'views_filters_summary',
    'ui_patterns',
    // `display_builder_views` ships the SCHEMA for the page display's
    // `display_builder` extender (BB-413, 2026-09-04). Without the module
    // `views.view.tickets` will not INSTALL at all: `ConfigSchemaChecker`
    // rejects `display_extenders.display_builder` as "missing schema", and
    // strict config schema is on by default in every Kernel test.
    'display_builder', 'ui_patterns_views', 'display_builder_views',
    'bb_core',
  ];

  /**
   * The account the one assigned ticket belongs to.
   */
  private UserInterface $assignee;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_project',
      'bb_ticket', 'bb_run', 'bb_term', 'search_api_task',
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['user', 'search_api']);
    BbVocabulary::create(['id' => 'label', 'label' => 'bakers.build labels'])->save();
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    // The tickets view left config/optional for its two homes on BB-315, so
    // the optional sweep above no longer creates it — install the recipe copy.
    $this->installShippedView('views.view.tickets');
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);

    $this->seed();
  }

  /**
   * Four tickets, one state and one priority each, one of them assigned.
   */
  private function seed(): void {
    $account = $this->createUser(['administer bakers', 'view bb_ticket']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);

    $assignee = $this->createUser([], 'ada');
    self::assertInstanceOf(UserInterface::class, $assignee);
    $this->assignee = $assignee;

    $workspace = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);
    $group = $this->create('bb_group', [
      'name' => 'Platform',
      'workspace_id' => $workspace->id(),
    ]);
    $project = $this->create('bb_project', [
      'name' => 'Wiring',
      'key' => 'wire',
      'group_id' => $group->id(),
    ]);

    // The spread is what makes the assertions bite: each priority selects
    // tickets of exactly one state, so a facet that has not narrowed is
    // visible as more than one value rather than as a wrong count.
    $tickets = [
      ['state' => 'working', 'workflow' => 'bb_work', 'priority' => 1],
      ['state' => 'review', 'workflow' => 'bb_work', 'priority' => 2],
      ['state' => 'plan', 'workflow' => 'bb_work', 'priority' => 3],
      // A second, unassigned `working` ticket, so the state's count differs
      // between the whole list (2) and the list narrowed to the assignee (1).
      ['state' => 'working', 'workflow' => 'bb_work', 'priority' => 1],
    ];
    foreach ($tickets as $i => $values) {
      $this->create('bb_ticket', $values + [
        'title' => 'Ticket ' . $values['state'],
        'project_id' => $project->id(),
        // Only the first priority-1 ticket is assigned, so `?priority[]=2`
        // leaves the assignee facet with no results AT ALL — which is the
        // corner contrib does not carry an active value through.
        'assignee_user_id' => $i === 0 ? $this->assignee->id() : NULL,
      ]);
    }

    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    self::assertSame(4, $index->indexItems(), 'An unindexed fixture proves nothing.');
  }

  /**
   * Creates and saves an entity of the given type.
   *
   * @param string $entity_type_id
   *   The entity type id.
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved entity.
   */
  private function create(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * Executes the view against the query a browser would produce.
   *
   * @param array<string, mixed> $query
   *   The raw query string.
   *
   * @return \Drupal\views\ViewExecutable
   *   The executed view.
   */
  private function executedView(array $query): ViewExecutable {
    $view = Views::getView('tickets');
    self::assertInstanceOf(ViewExecutable::class, $view);
    self::assertTrue($view->setDisplay(self::DISPLAY_ID));
    // HANDED OVER DIRECTLY since 2026-09-04. `TicketFilterSet::chosen()`
    // used to narrow this first and the class is deleted; the value-less-entry
    // guard that replaced it went too (2026-09-05), because nothing this
    // screen renders can submit a value-less entry. Every query below states
    // a real value.
    $view->setExposedInput($query);
    $view->preExecute([self::WORKSPACE_SLUG]);
    $view->execute(self::DISPLAY_ID);
    return $view;
  }

  /**
   * One facet's RENDERED option values, in row order.
   *
   * The clear row is dropped: it carries the empty value, which is the absence
   * of a choice rather than a value that could yield a hit.
   *
   * @param string $identifier
   *   The facet's exposed identifier, which is also its name in the URL.
   * @param array<string, mixed> $query
   *   The query string the rows are rendered for.
   *
   * @return array<int, string>
   *   The submitted values, in row order.
   */
  private function renderedValues(string $identifier, array $query): array {
    // `strval` rather than the keys themselves: PHP coerces a numeric string
    // array key to an integer, and a facet value is a string in the URL.
    return array_map(strval(...), array_keys($this->renderedRows($identifier, $query)));
  }

  /**
   * One facet's rendered rows, as submitted value => checked.
   *
   * The two sentinels are dropped, because neither is a value that could yield
   * a hit: `''` is `option_list`'s own clear row — a reset LINK now, not a
   * control — and `All` is Views' "- Any -" on a single-select filter, which
   * `BbOptionPickerWidget` no longer offers as a row at all. They are the
   * same two the value-less-entry guard drops from a request, and the filter is
   * kept here so this harness reads the panel rather than the widget's current
   * option set.
   *
   * @param string $identifier
   *   The facet's exposed identifier.
   * @param array<string, mixed> $query
   *   The query string the rows are rendered for.
   *
   * @return array<string, bool>
   *   Submitted value => whether the row's control is checked.
   */
  private function renderedRows(string $identifier, array $query): array {
    $view = $this->executedView($query);
    $exposed_form = $view->display_handler->getPlugin('exposed_form');
    self::assertInstanceOf(ExposedFormPluginInterface::class, $exposed_form);
    $form = $exposed_form->renderExposedForm(TRUE);
    self::assertArrayHasKey($identifier, $form, sprintf(
      'Facet %s is not in the exposed form.',
      $identifier,
    ));

    $html = (string) $this->container->get('renderer')
      ->renderInIsolation($form[$identifier]);
    $document = new \DOMDocument();
    @$document->loadHTML('<div>' . $html . '</div>');
    $xpath = new \DOMXPath($document);

    $rows = [];
    $nodes = $xpath->query('//li[@data-value]');
    self::assertInstanceOf(\DOMNodeList::class, $nodes);
    foreach ($nodes as $node) {
      if (!$node instanceof \DOMElement) {
        continue;
      }
      $value = $node->getAttribute('data-value');
      if ($value === '' || $value === 'All') {
        continue;
      }
      $checked = $xpath->query('.//input[@checked]', $node);
      $rows[$value] = $checked instanceof \DOMNodeList && $checked->length > 0;
    }
    return $rows;
  }

  /**
   * Each state row counts the tickets it would list.
   *
   * The count sits in the row's own `count`, not in its label: contrib's
   * `show_numbers` appends " (2)" to the label, which would also reach the
   * trigger's value labels. `state` is an `or` facet, so choosing a state
   * leaves its own counts whole.
   */
  public function testStateOptionsCarryCounts(): void {
    $rows = $this->offeredRows('state', ['state' => ['working']]);

    self::assertSame(
      ['plan' => ['Plan', '1'], 'review' => ['Review', '1'], 'working' => ['Working', '2']],
      $rows['options'],
    );
    self::assertSame(['Working'], $rows['value_labels']);
  }

  /**
   * A state's count follows the other active filters.
   *
   * A test of its own: contrib keeps each processed facet in a static for the
   * rest of the request, so a second execution here would read the first.
   */
  public function testStateCountsFollowTheOtherFilters(): void {
    self::assertSame(
      ['working' => ['Working', '1']],
      $this->offeredRows('state', ['assignee' => [(string) $this->assignee->id()]])['options'],
      'Only the assigned of the two working tickets is counted.',
    );
  }

  /**
   * A chosen state the other filters leave without hits still shows a count.
   *
   * The assignee's one ticket has priority 1, so adding priority 2 leaves the
   * state facet with no results at all; the chosen row is the widget's own
   * (`withChosenRows()`), and every state row shows a number, so it reads 0.
   */
  public function testChosenStateWithoutHitsCountsZero(): void {
    self::assertSame(
      ['review' => ['review', '0']],
      $this->offeredRows('state', [
        'assignee' => [(string) $this->assignee->id()],
        'priority' => ['2'],
        'state' => ['review'],
      ])['options'],
    );
  }

  /**
   * One facet's offered rows as value => [label, count], and its value labels.
   *
   * Read from the props the widget hands `option_list`, sorted by value: the
   * backend's facet order is not part of the contract.
   *
   * @param string $identifier
   *   The facet's exposed identifier.
   * @param array<string, mixed> $query
   *   The query string the rows are rendered for.
   *
   * @return array{options: array<string, array{0: string, 1: string|null}>, value_labels: array<int, string>}
   *   The rows and the trigger's value labels.
   */
  private function offeredRows(string $identifier, array $query): array {
    $view = $this->executedView($query);
    $exposed_form = $view->display_handler->getPlugin('exposed_form');
    self::assertInstanceOf(ExposedFormPluginInterface::class, $exposed_form);
    $picker = $exposed_form->renderExposedForm(TRUE)[$identifier];

    $options = [];
    foreach ($picker['#slots']['options']['#props']['options'] as $option) {
      $options[$option['value']] = [$option['label'], $option['count'] ?? NULL];
    }
    ksort($options);
    return ['options' => $options, 'value_labels' => $picker['#props']['value_labels']];
  }

  /**
   * A facet narrowed by another facet offers only what still yields a hit.
   */
  public function testTheFacetOffersOnlyValuesThatYieldHits(): void {
    self::assertSame(
      ['working'],
      $this->renderedValues('state', ['priority' => ['1']]),
      'Only the two priority-1 tickets are left, and working is their only state.',
    );
    self::assertSame(
      ['bb_work'],
      $this->renderedValues('workflow', ['priority' => ['1']]),
    );
  }

  /**
   * A facet that is itself chosen keeps its own values, because it is `or`.
   *
   * This is the guard on not "fixing" the operator into self-filtering: with
   * `and` the panel would offer only the value already picked and a reader
   * could never add a second one.
   */
  public function testTheChosenFacetKeepsItsOwnValues(): void {
    self::assertSame(
      ['1', '2', '3'],
      $this->renderedValues('priority', ['priority' => ['1']]),
      'An `or` facet is excluded from its own filter and keeps its full set.',
    );
  }

  /**
   * A chosen value that no longer yields a hit is still offered, and checked.
   */
  public function testTheChosenValueSurvivesWhenItYieldsNothing(): void {
    $rows = $this->renderedRows('state', ['priority' => ['1'], 'state' => ['review']]);

    self::assertArrayHasKey(
      'review',
      $rows,
      'A chosen filter that matches nothing must stay removable from the panel.',
    );
    self::assertTrue($rows['review'], 'The chosen row must be checked.');
  }

  /**
   * A chosen value survives even a facet with no results at all.
   *
   * Only the first priority-1 ticket is assigned, so `?priority[]=2` leaves
   * the assignee facet with an empty result set. Contrib re-adds a chosen value
   * only while it has some result to re-add it to, so this corner is the
   * widget's to hold — and if it drops it, the next pick of any other facet
   * silently loses the assignee filter, because an unrendered checkbox is not
   * submitted.
   *
   * THIS TEST IS THE MEASUREMENT THAT KEPT THE GUARD. Removing
   * `BbOptionPickerWidget::withChosenRows()` fails it with "The chosen
   * assignee vanished from the panel", so the case it exists for is still live
   * with `min_count: 1` in place. It is more load-bearing than it was, not
   * less: the clear row submits nothing now, and Views' `All` row is no longer
   * offered, so on a single-value facet the chosen row is the only element in
   * the panel carrying the value.
   */
  public function testTheChosenValueSurvivesAnEmptyFacet(): void {
    $uid = (string) $this->assignee->id();
    $rows = $this->renderedRows('assignee', [
      'priority' => ['2'],
      'assignee' => [$uid],
    ]);

    self::assertArrayHasKey($uid, $rows, 'The chosen assignee vanished from the panel.');
    self::assertTrue($rows[$uid], 'The chosen row must be checked.');
  }

}
