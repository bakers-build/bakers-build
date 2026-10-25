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
 * The panel's clear row resets a facet without submitting a value.
 *
 * WHAT THIS REPLACES, AND WHY IT WAS A DEFECT AND NOT A STYLE. `option_list`
 * rendered the clear row as a real form control carrying the EMPTY value, and
 * `clear_selected` is derived — true exactly when nothing else is checked — so
 * the exposed form submitted `state[]=` beside `state[]=coding` on the first
 * pick, and an empty value for every facet with nothing chosen on every submit.
 * `FacetsFilter::getActiveFacetValues()` reads the raw request rather than the
 * processed form values and treats `''` as an active facet value, so the query
 * matched nothing: measured on the live surface, `?state[]=coding` returned 5
 * rows and `?state[]=coding&group=` returned 0.
 *
 * The previous answer was to strip the empty values on the way in, which is a
 * plaster over a control that should never have submitted one. This is the
 * cause removed: the clear row is not a form control at all.
 *
 * IT IS A LINK, WHICH IS THE SAME AFFORDANCE THE CHIP'S × IS, and that is the
 * point rather than a coincidence. Resetting a facet means the address without
 * it, and the two are computed in two places since 2026-09-04 — the chips are
 * `views_filters_summary`'s and their addresses are built in
 * `bb_theme/templates/views-filters-summary.html.twig`, while this row's is
 * built by `BbOptionPickerWidget`, which is the only PHP caller left. What
 * has to agree is the SPELLING, and both write the current path plus every
 * other facet's values as `id[]=value`; this file asserts the parsed filter set
 * rather than a string, so the two cannot drift into addressing different
 * removals without failing here. A link also holds the standard the rest of
 * this panel is held to: it works with JavaScript disabled, where an
 * unchecked-by-script control would not.
 *
 * THE `All` SENTINEL IS NOT THE ANSWER, MEASURED. Views offers `- Any -` as
 * a real option on a single-value exposed filter, and it looked like the
 * framework's own reset. `FacetsFilter.php:809` tests `$enabled == 'All'`
 * BEFORE the array branch, so in a multi-value group `All` falls through to
 * `normalizeActiveFacetValues(['All'])` and is queried as a literal facet
 * value: on the live surface `?state[]=All` returned 0 rows, `?state=All`
 * returned 10 and `?group[]=All` returned 0. Field-dependent and silent. It is
 * also a SECOND reset row beside ours on each of the four single-value facets,
 * labelled with the generic `- Any -` that `option_list` exists to refuse. So
 * it is not offered.
 */
#[Group('bb_core')]
final class TicketFacetClearRowTest extends KernelTestBase {

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
   * Three tickets in three states, all in one group, all indexed.
   */
  private function seed(): void {
    $account = $this->createUser(['administer bakers', 'view bb_ticket']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);

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

    foreach (['coding', 'review', 'spec'] as $i => $state) {
      $this->create('bb_ticket', [
        'title' => 'Ticket ' . $state,
        'workflow' => 'bb_work',
        'state' => $state,
        'priority' => $i + 1,
        'project_id' => $project->id(),
      ]);
    }

    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    self::assertSame(3, $index->indexItems());
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
   * One facet's rendered panel, as a DOM the assertions can query.
   *
   * @param string $identifier
   *   The facet's exposed identifier.
   * @param array<string, mixed> $query
   *   The query string the panel is rendered for.
   *
   * @return \DOMXPath
   *   The panel's DOM.
   */
  private function panel(string $identifier, array $query): \DOMXPath {
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

    $exposed_form = $view->display_handler->getPlugin('exposed_form');
    self::assertInstanceOf(ExposedFormPluginInterface::class, $exposed_form);
    $form = $exposed_form->renderExposedForm(TRUE);
    self::assertArrayHasKey($identifier, $form);

    $html = (string) $this->container->get('renderer')
      ->renderInIsolation($form[$identifier]);
    $document = new \DOMDocument();
    @$document->loadHTML('<div>' . $html . '</div>');
    return new \DOMXPath($document);
  }

  /**
   * The clear row of one rendered panel.
   *
   * @param string $identifier
   *   The facet's exposed identifier.
   * @param array<string, mixed> $query
   *   The query string the panel is rendered for.
   *
   * @return array{0: \DOMElement, 1: \DOMXPath}
   *   The clear row and the DOM it belongs to.
   */
  private function clearRow(string $identifier, array $query): array {
    $xpath = $this->panel($identifier, $query);
    $rows = $xpath->query('//li[@data-option-list-clear]');
    self::assertInstanceOf(\DOMNodeList::class, $rows);
    self::assertSame(1, $rows->length, sprintf(
      'Facet %s renders %d clear rows.',
      $identifier,
      $rows->length,
    ));
    $row = $rows->item(0);
    self::assertInstanceOf(\DOMElement::class, $row);
    return [$row, $xpath];
  }

  /**
   * The clear row carries no form control, so it submits nothing.
   *
   * This is the defect removed at its cause. An `<input value="">` in this row
   * is what put `state[]=` in the query beside the chosen value, and what put
   * an empty value for all seven facets in every submit.
   */
  public function testTheClearRowSubmitsNothing(): void {
    foreach ([['state', ['coding']], ['group', '1']] as [$identifier, $value]) {
      [$row, $xpath] = $this->clearRow($identifier, [$identifier => $value]);
      $inputs = $xpath->query('.//input', $row);
      self::assertInstanceOf(\DOMNodeList::class, $inputs);
      self::assertSame(0, $inputs->length, sprintf(
        'The %s clear row still carries a form control, so it still submits.',
        $identifier,
      ));
    }
  }

  /**
   * The clear row is a link to this address without that facet.
   *
   * The same address the chip's × uses — see
   * `BbOptionPickerWidget::addressWithoutFacet()`. Parsed rather than
   * string-matched, because the PATH is whatever request the harness is on and
   * the assertion is about the filter set the link leaves behind.
   */
  public function testTheClearRowLinksToTheAddressWithoutThatFacet(): void {
    [$row, $xpath] = $this->clearRow('state', [
      'state' => ['coding'],
      'priority' => ['2'],
    ]);

    $links = $xpath->query('.//a[@href]', $row);
    self::assertInstanceOf(\DOMNodeList::class, $links);
    self::assertSame(1, $links->length, 'The clear row is not a link.');
    $link = $links->item(0);
    self::assertInstanceOf(\DOMElement::class, $link);

    $remaining = [];
    parse_str(
      (string) parse_url(html_entity_decode($link->getAttribute('href')), PHP_URL_QUERY),
      $remaining,
    );
    self::assertArrayNotHasKey('state', $remaining, 'The row did not clear its facet.');
    self::assertSame(['2'], array_values((array) ($remaining['priority'] ?? [])));
  }

  /**
   * With nothing chosen there is nothing to clear, and no link either.
   *
   * A row whose address is the address the reader is already on is a control
   * that does nothing. The row stays — it is the marker that says "no state is
   * chosen" — but it is not offered as an action.
   */
  public function testTheUnfilteredFacetClearRowIsNoLink(): void {
    [$row, $xpath] = $this->clearRow('state', []);

    $links = $xpath->query('.//a[@href]', $row);
    self::assertInstanceOf(\DOMNodeList::class, $links);
    self::assertSame(0, $links->length, 'There is nothing to clear.');
    self::assertSame('true', $row->getAttribute('aria-selected'));
  }

  /**
   * Views' `- Any -` sentinel is not offered as a row.
   *
   * It was a second reset beside the clear row on each single-value facet, and
   * `FacetsFilter` queries it as a literal value inside a multi-value group.
   */
  public function testTheViewsAnySentinelIsNotOffered(): void {
    foreach (['group', 'project', 'workflow', 'assignee'] as $identifier) {
      $xpath = $this->panel($identifier, []);
      $rows = $xpath->query('//li[@data-value="All"]');
      self::assertInstanceOf(\DOMNodeList::class, $rows);
      self::assertSame(0, $rows->length, sprintf(
        'Facet %s still offers the `All` sentinel as a row.',
        $identifier,
      ));
    }
  }

}
