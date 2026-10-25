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
use Symfony\Component\Yaml\Yaml;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * A facet reads by the label the rest of the product reads by, not by its id.
 *
 * WHY THIS IS NOT A FIX TO THE INDEX. `labels`, `assignee_user_id`,
 * `conductor_id`, `project_id`, `group_id` and `priority` index over target ids
 * and machine names, which is what makes them filterable at all — an index over
 * entity labels would put a renamed label into the URL and break every shared
 * link the moment someone renames a term. So the id stays the value and the
 * label is resolved where the display is built.
 *
 * IT ASSERTS THE RENDERED ROW AND THE RENDERED CHIP, keyed by the value the
 * control still submits. Asserting an intermediate array is exactly the wrong
 * level here: the defect class is a value that looks right one layer down, and
 * the pairing of `data-value` with the row's visible text is the only reading
 * that states both halves at once — the operator sees `bug`, the URL carries
 * `2`.
 *
 * THE TWO SURFACES ARE ASSERTED AGAINST EACH OTHER, not against two hand-typed
 * expectations. The option row and the chip come from one resolver, and the
 * test that proves it is the one comparing them: a chip and a row that
 * disagree about what a value is called is a defect no per-surface assertion
 * can see.
 */
#[Group('bb_core')]
final class TicketFacetLabelsTest extends KernelTestBase {

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

  /**
   * The public tail of the display these assertions render.
   *
   * `page_1` MOVED DOWN ONE SEGMENT ON 2026-09-04. The human decided that a
   * filtered variant of the ticket list is a Views DISPLAY with real filters
   * rather than the same display reached with facet defaults, so the scoped
   * `my_work` display took `/{workspace}/tickets` — the nav home — and the full
   * find-a-ticket table this file renders is `/{workspace}/tickets/all`.
   *
   * IT IS NOT COSMETIC HERE. `views-filters-summary.html.twig` builds a chip's
   * removal address from `path('<current>')`, so the address a chip carries is
   * the address the REQUEST was made at. A request pushed at the old path would
   * produce chips pointing at the scoped list, which is a different screen.
   */
  private const PATH = '/tickets/all';

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
   * The label term the labelled ticket carries.
   */
  private ContentEntityInterface $label;

  /**
   * The project every ticket belongs to.
   */
  private ContentEntityInterface $project;

  /**
   * The group that project belongs to.
   */
  private ContentEntityInterface $group;

  /**
   * The account one ticket is assigned to.
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
    // Without the tracker's own table nothing is ever tracked and indexItems()
    // answers 0 with no error at all.
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['user', 'search_api', 'views']);
    // The label vocabulary belongs to the recipe, which a Kernel test does not
    // apply, so the fixture creates it.
    BbVocabulary::create(['id' => 'label', 'label' => 'bakers.build labels'])->save();
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    // The display builder profile the view's extender names. It lives in
    // `display_builder/config/optional`, so a module install does not create it
    // and the extender would fall back to the un-built view.
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'display_builder']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    // The tickets view left config/optional for its two homes on BB-315, so
    // the optional sweep above no longer creates it — install the recipe copy.
    $this->installShippedView('views.view.tickets');
    $this->container->get('router.builder')->rebuild();
    // Without the theme the component id does not resolve at all — and it has
    // to be the DEFAULT theme, not merely installed. Measured on 2026-09-04:
    // with `core` active the exposed form does not render its `option_picker`
    // components, `FilterPluginBase::acceptExposedInput()` never runs, the
    // facets filter's `value` stays `[]`, and `views_filters_summary` — which
    // reads exactly that property — states no chip at all while the query is
    // still narrowed from the raw request.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    // The canvas the page display composes. A Kernel test does not run
    // `hook_install()`, so `display_builder_views_install()` — the only thing
    // that appends `display_builder` to `views.settings` › `display_extenders`
    // — never fires, and the display renders with no canvas at all. The value
    // is read from `config/sync`, which is what the CIM path installs, so this
    // fails if the repository stops shipping it.
    $shipped = Yaml::parseFile(dirname(__DIR__, 7) . '/config/sync/views.settings.yml');
    self::assertIsArray($shipped);
    self::assertContains('display_builder', $shipped['display_extenders'] ?? []);
    $this->config('views.settings')
      ->set('display_extenders', $shipped['display_extenders'])
      ->save();

    $this->seed();
  }

  /**
   * Three tickets spread across every facet's values, all indexed.
   */
  private function seed(): void {
    // `administer bakers` bypasses the read scope, so this fixture is about the
    // labels rather than about tenancy — which TicketIndexReadScopeTest owns.
    // It deliberately does NOT grant `access user profiles`: no role on a real
    // bakers.build site has it, so a fixture that granted it would test a world
    // that does not exist and would hide whether the assignee facet is
    // readable.
    $account = $this->createUser(['administer bakers', 'view bb_ticket']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);

    $assignee = $this->createUser([], 'ada');
    self::assertInstanceOf(UserInterface::class, $assignee);
    $this->assignee = $assignee;

    $workspace = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);
    $this->group = $this->create('bb_group', [
      'name' => 'Platform',
      'workspace_id' => $workspace->id(),
    ]);
    $this->project = $this->create('bb_project', [
      'name' => 'Wiring',
      'key' => 'wire',
      'group_id' => $this->group->id(),
    ]);
    $this->label = $this->create('bb_term', [
      'vid' => 'label',
      'name' => 'bug',
      'workspace_id' => $workspace->id(),
    ]);

    $tickets = [
      ['state' => 'working', 'workflow' => 'bb_work', 'priority' => 1],
      ['state' => 'review', 'workflow' => 'bb_work', 'priority' => 2],
      ['state' => 'plan', 'workflow' => 'bb_work', 'priority' => 3],
    ];
    foreach ($tickets as $i => $values) {
      $this->create('bb_ticket', $values + [
        'title' => 'Ticket ' . $values['state'],
        'project_id' => $this->project->id(),
        'assignee_user_id' => $i === 0 ? $this->assignee->id() : NULL,
        'labels' => $i === 0 ? [$this->label->id()] : [],
      ]);
    }

    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    self::assertSame(
      3,
      $index->indexItems(),
      'All three tickets must be in the index, or an empty facet proves nothing.',
    );
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
   * One facet's RENDERED option rows, as submitted value => visible text.
   *
   * The pairing is the assertion's whole point: the key is what the control
   * submits and the value is what the operator reads, so a test on it cannot
   * pass by having quietly changed the URL.
   *
   * @param string $identifier
   *   The facet's exposed identifier, which is also its name in the URL.
   *
   * @return array<string, string>
   *   Submitted value => the row's rendered label.
   */
  private function renderedRows(string $identifier): array {
    $view = $this->executedView([]);
    $exposed_form = $view->display_handler->getPlugin('exposed_form');
    self::assertInstanceOf(ExposedFormPluginInterface::class, $exposed_form);
    // TRUE is the `$block` parameter: the island places the form in the canvas
    // `filters` slot rather than above the table (spec D5, F8).
    $form = $exposed_form->renderExposedForm(TRUE);
    self::assertArrayHasKey(
      $identifier,
      $form,
      sprintf('Facet %s is not in the exposed form.', $identifier),
    );

    $html = (string) $this->container->get('renderer')
      ->renderInIsolation($form[$identifier]);
    $document = new \DOMDocument();
    // The fragment is not a document, and the theme's class attributes are not
    // HTML the parser has an opinion worth hearing about.
    @$document->loadHTML('<div>' . $html . '</div>');
    $xpath = new \DOMXPath($document);

    $rows = [];
    foreach ($this->elements($xpath, '//li[@data-value]') as $row) {
      $labels = $this->elements($xpath, './/span[contains(@class, "option-list__label")]', $row);
      $label = $labels === [] ? '' : $labels[0]->textContent;
      $rows[$row->getAttribute('data-value')] = trim($label);
    }
    return $rows;
  }

  /**
   * The elements one XPath expression selects.
   *
   * @param \DOMXPath $xpath
   *   The XPath evaluator.
   * @param string $expression
   *   The expression.
   * @param \DOMElement|null $context
   *   The context node, or NULL for the whole document.
   *
   * @return array<int, \DOMElement>
   *   The elements, in document order.
   */
  private function elements(\DOMXPath $xpath, string $expression, ?\DOMElement $context = NULL): array {
    $nodes = $xpath->query($expression, $context);
    self::assertInstanceOf(\DOMNodeList::class, $nodes, 'The XPath expression is invalid.');

    $elements = [];
    foreach ($nodes as $node) {
      if ($node instanceof \DOMElement) {
        $elements[] = $node;
      }
    }
    return $elements;
  }

  /**
   * The screen one query string renders, the way a request renders it.
   *
   * THE CHIPS ARE READ OFF THIS since 2026-09-04, and they come from contrib:
   * `views_filters_summary` states the chosen facets and
   * `bb_theme/templates/views-filters-summary.html.twig` renders them as
   * `bb_theme:active-filters`. There is no bakers PHP in that path any more,
   * so the only honest place to read a chip is the rendered screen.
   *
   * IT RENDERS THE WHOLE DISPLAY FROM A REQUEST, and every part of that is a
   * measured requirement of the module rather than tidiness. Our presenter
   * read `$view->exposed_data ?: $view->getExposedInput()`;
   * `ViewsFiltersSummary::hasValidFilterValue()` reads `$filter->value`, which
   * only the exposed FORM populates. Measured with `setExposedInput()` plus
   * `execute()` and then `renderArea('header')`: `value=[]`,
   * `hasValidFilterValue: false`, and the summary rendered as the empty string
   * — while the query was still narrowed, because
   * `FacetsFilter::getActiveFacetValues()` reads the raw request. So the rows
   * were right and the chips were absent, which is exactly the class of defect
   * this file exists to catch. `buildRenderable()` against a pushed request
   * drives both halves the way `ViewPageController` does.
   *
   * @param string $query
   *   The query string, without a leading `?`.
   *
   * @return string
   *   The rendered screen.
   */
  private function screenFor(string $query): string {
    $request = Request::create('/' . self::WORKSPACE_SLUG . self::PATH . '?' . $query);
    // The exposed form is a real form and `FormBuilder` reads the session for
    // its token; carrying the harness's session over is what makes this the
    // same kind of request a browser sends. The route match comes with it,
    // because a chip's removal address is built from `path('<current>')`.
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    else {
      $request->setSession(new Session(new MockArraySessionStorage()));
    }
    $request->attributes->add(
      $this->container->get('router')->matchRequest($request)
    );
    $this->container->get('request_stack')->push($request);
    try {
      $view = Views::getView('tickets');
      self::assertInstanceOf(ViewExecutable::class, $view);
      $build = $view->buildRenderable(self::DISPLAY_ID, [self::WORKSPACE_SLUG]);

      return (string) $this->container->get('renderer')->renderInIsolation($build);
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * The chip sentence a rendered screen states.
   *
   * @param string $html
   *   The rendered screen.
   *
   * @return string
   *   The strip's text, whitespace-collapsed, or '' when there is no strip.
   */
  private function chipText(string $html): string {
    $start = strpos($html, 'data-component-id="bb_theme:active-filters"');
    if ($start === FALSE) {
      return '';
    }
    $end = strpos($html, 'data-active-filters="chips"', $start);
    self::assertNotFalse($end, 'The strip has no chips container.');
    $end = strpos($html, '</div>', $end);
    self::assertNotFalse($end);

    return trim((string) preg_replace(
      '/\s+/',
      ' ',
      strip_tags(substr($html, $start, $end - $start)),
    ));
  }

  /**
   * The label the option row for one value reads, off a rendered screen.
   *
   * SCOPED TO ITS OWN FACET (BB-416). A raw `data-value` is not unique
   * across facets — the `owner` facet's uid and the `priority` facet's level
   * can both literally read `1` — so a search over every `<li>` in the whole
   * screen can return the FIRST match in document order regardless of which
   * facet the caller meant. `option_picker.twig` gives each facet's PANEL,
   * where the `<li>` rows actually live, the id `filter-<identifier>__panel`
   * (`picker_id ~ '__panel'`, `option_picker.twig:93-94`, with `picker_id`
   * set from `BbOptionPickerWidget.php:279`'s `id="filter-<key>"`); the
   * `filter-<identifier>` id itself sits on the trigger BUTTON, a sibling of
   * the panel rather than an ancestor of its rows, so the panel id is the one
   * that actually scopes them.
   *
   * @param string $html
   *   The rendered screen.
   * @param string $identifier
   *   The facet's exposed identifier, which is also its filter widget id.
   * @param string $value
   *   The value the row submits.
   *
   * @return string|null
   *   The row's visible text, or NULL when no row carries that value.
   */
  private function rowLabelIn(string $html, string $identifier, string $value): ?string {
    $document = new \DOMDocument();
    @$document->loadHTML($html);
    $xpath = new \DOMXPath($document);

    $scopes = $this->elements($xpath, sprintf('//*[@id="filter-%s__panel"]', $identifier));
    self::assertNotSame([], $scopes, sprintf('No filter panel carries id="filter-%s__panel".', $identifier));

    foreach ($this->elements($xpath, './/li[@data-value]', $scopes[0]) as $row) {
      if ($row->getAttribute('data-value') !== $value) {
        continue;
      }
      $labels = $this->elements($xpath, './/span[contains(@class, "option-list__label")]', $row);

      return $labels === [] ? '' : trim($labels[0]->textContent);
    }

    return NULL;
  }

  /**
   * Every entity-reference facet reads by the referenced entity's label.
   *
   * `group` is in this list on purpose: it reaches bb_group through the
   * project rather than through the ticket, so it is the one facet whose label
   * cannot be found on bb_ticket at all.
   */
  public function testTheEntityFacetsReadTheReferencedLabel(): void {
    self::assertSame(
      'ada',
      $this->renderedRows('assignee')[(string) $this->assignee->id()] ?? NULL,
      'A uid is not a person a reader can recognise.',
    );
    self::assertSame(
      'Wiring',
      $this->renderedRows('project')[(string) $this->project->id()] ?? NULL,
    );
    self::assertSame(
      'Platform',
      $this->renderedRows('group')[(string) $this->group->id()] ?? NULL,
      'group_id traverses the project, so its label is the one facet not on the ticket.',
    );
    self::assertSame(
      'bug',
      $this->renderedRows('label')[(string) $this->label->id()] ?? NULL,
    );
  }

  /**
   * The submitted value is still the id, so a rename cannot break a link.
   */
  public function testTheSubmittedValueIsStillTheId(): void {
    self::assertArrayHasKey(
      (string) $this->label->id(),
      $this->renderedRows('label'),
      'Resolving the display label must not move the label into the URL.',
    );
    self::assertArrayHasKey('working', $this->renderedRows('state'));
  }

  /**
   * An id nothing resolves states NO CHIP, which is a behaviour change.
   *
   * IT USED TO READ `Labels includes any of —`, and both halves of that
   * sentence are gone with `views_filters_summary`, so this test states what
   * the module actually does rather than what its predecessor did.
   *
   *   - The em-dash was ours. `TicketFilterSet::displayValue()` turned facets'
   *     `getNestedSummaryValue() === FALSE` into the same faint em-dash the
   *     table uses for an absent value. `facets_exposed_filters`'
   *     `hook_views_filters_summary_info_alter()` DROPS such a value instead
   *     (`if ($facetSummaryItem !== FALSE)`), so the facet's value list comes
   *     back empty, `ViewsFiltersSummary::hasValidDefinitionValue()` rejects
   *     the definition and the facet contributes no entry at all.
   *   - `includes any of` was the `summary_operator` on the Labels widget, and
   *     nothing in the module's theme hook can reach a filter's widget
   *     configuration — see `views-filters-summary.html.twig`.
   *
   * SO A DANGLING REFERENCE STATES NO CHIP: the query is still narrowed by it —
   * `FacetsFilter` reads the raw request — and no chip names it. The row-level
   * compensation is `BbOptionPickerWidget::withChosenRows()`, which keeps a
   * chosen value REMOVABLE in the panel even when its facet has no result, so
   * the filter is not stuck.
   *
   * AND SINCE 2026-09-04 THE STRIP READS `All tickets` OVER IT, which is a
   * FALSE STATEMENT and a decision rather than an oversight. BB-413 made the
   * unfiltered statement reachable again: `active-filters` declares a `chips`
   * slot, the view's `display_builder` tree wraps `view_header` in a node that
   * fills it, and the component states `empty_label` when that slot renders
   * nothing. The slot rendering nothing means "the module named no facet", and
   * the module names no facet in TWO cases — no filter has a value, and every
   * value present is one its build processors cannot name. The component cannot
   * tell them apart, and nothing reachable from a component or from Views
   * config can: distinguishing them needs the raw request, which is a hook or a
   * presenter of ours, and the decision of 2026-09-04 that took the module
   * refused both.
   *
   * THE TRADE, STATED. Before: silence above every unfiltered list, which the
   * human had asked twice to be `All tickets`, and silence above a
   * dangling-reference list. After: the statement above every unfiltered list,
   * and a wrong statement above a dangling-reference list. The unfiltered case
   * is what a reader meets on every visit to the screen; the dangling one needs
   * a hand-edited address or a deleted term and renders an empty table, which
   * reads as broken on its own. So the common case is served and the degenerate
   * one is wrong, on the record, here.
   *
   * The chip-level claim is unchanged and still the one that matters most: the
   * raw id must never reach the reader.
   */
  public function testAnIdNothingResolvesStatesTheUnfilteredWordAndNoChip(): void {
    $html = $this->screenFor('label[]=999999');
    $text = $this->chipText($html);

    self::assertStringNotContainsString(
      '999999',
      $text,
      'A dangling reference must never read as a raw id.',
    );
    self::assertStringNotContainsString(
      'data-facet',
      $html,
      'The module drops a value the facet cannot name, so no chip states it.',
    );
    self::assertStringContainsString(
      'All tickets',
      $text,
      'The strip cannot tell "nothing chosen" from "nothing nameable", and says the former.',
    );
  }

  /**
   * The Labels facet reads `includes any of`, and the CALLER supplies it.
   *
   * AC 6, LOST ON 2026-09-04 AND RESTORED ON 2026-09-05 BY A DIFFERENT ROUTE.
   * `Labels` used to read this word from a `summary_operator` on its BEF
   * widget, and that path is genuinely dead: a `views_filters_summary` summary
   * entry carries exactly `id`, `label` and `groups`
   * (`buildFilterSummaryGroupedItem()` builds a fresh array from those three,
   * so even a key added by `hook_views_filters_summary_info_alter()` is
   * discarded), and the theme hook declares only `summary`, `options` and
   * `exposed_form_id`. There is no path from a filter's widget configuration to
   * the template, and the decision that took the module refused a hook of ours.
   *
   * WHAT THERE IS A PATH FOR IS THE FACET'S OWN IDENTIFIER. `active-filters`
   * has always accepted a per-facet `operator` override — the prop predates the
   * module — and the entry's `id` is the exposed identifier the checkboxes
   * submit. So `views-filters-summary.html.twig` maps the identifier to the
   * word, which is the caller stating its own vocabulary rather than the view
   * carrying it, and is the same kind of decision as `empty_label`.
   *
   * IT IS ASSERTED ON THE SENTENCE, not on the map: `Labels includes any of
   * <name>` is what a reader sees, and a map that was right while the template
   * printed the derived operator anyway would pass any assertion made on the
   * map alone.
   */
  public function testTheLabelsChipReadsItsOwnOperator(): void {
    $html = $this->screenFor('label[]=' . $this->label->id());

    self::assertStringContainsString(
      'Labels includes any of',
      $this->chipText($html),
      'A facet whose values are a SET reads `includes any of`, not the derived `is`.',
    );
  }

  /**
   * The chip and the option row cannot disagree about a value's name.
   *
   * Both are asserted against each other rather than against two typed
   * expectations, because one resolver behind two callers is the property under
   * test — and a second copy of the mapping would pass a per-surface assertion
   * while contradicting itself on screen. Since 2026-09-04 the two callers are
   * in two different codebases: the panel row is
   * `BbOptionPickerWidget::exposedFormAlter()` reading the facet's
   * `getDisplayValue()`, and the chip is `views_filters_summary` reading what
   * `facets_exposed_filters` resolved with the SAME build processors. That
   * makes this the assertion that matters most on this file.
   *
   * IT READS EVERY FACET OFF ONE RENDER, and that is a measured requirement
   * rather than economy. `ViewsFiltersSummary::hasValidFilterValue()` reads
   * `$filter->value`, which only the exposed FORM populates — and in this
   * harness only the FIRST `renderExposedForm()` of a PHP process does so: a
   * second screen comes back with `value=[]` and no strip at all, while
   * `exposed_data` is correctly `{"state":{"working":"working"}}` and the
   * option rows are right. Measured on 2026-09-04, first iteration green and
   * second iteration empty. One render sidesteps it, and it is the stronger
   * claim anyway: all seven facets are asserted to agree with their own rows at
   * the same time, on the same document a reader would be looking at.
   *
   * THE SEVEN VALUES ARE ONE TICKET'S, which is what keeps every facet's result
   * set non-empty: `min_count: 1` means a facet offers only what still yields a
   * hit, so a combination matching nothing would empty six facets and prove
   * nothing about their labels.
   */
  public function testEveryChipReadsWhatItsOptionRowReads(): void {
    $chosen = [
      'state' => 'working',
      'workflow' => 'bb_work',
      'priority' => '1',
      'assignee' => (string) $this->assignee->id(),
      'project' => (string) $this->project->id(),
      'group' => (string) $this->group->id(),
      'label' => (string) $this->label->id(),
    ];

    $query = [];
    foreach ($chosen as $identifier => $value) {
      $query[] = rawurlencode($identifier) . '[]=' . rawurlencode($value);
    }
    $html = $this->screenFor(implode('&', $query));
    $chips = $this->chipText($html);
    self::assertNotSame('', $chips, 'No chip strip rendered at all.');

    foreach ($chosen as $identifier => $value) {
      $row = $this->rowLabelIn($html, $identifier, $value);
      self::assertNotNull($row, sprintf('Facet %s offers no row for %s.', $identifier, $value));
      self::assertNotSame('', $row, sprintf('Facet %s renders an empty row label.', $identifier));
      self::assertStringContainsString(
        $row,
        $chips,
        sprintf('The %s chip does not read what its own option row reads.', $identifier),
      );
    }
  }

}
