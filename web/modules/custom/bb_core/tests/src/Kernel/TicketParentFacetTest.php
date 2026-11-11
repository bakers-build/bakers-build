<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\TypedData\ComplexDataInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\search_api\Entity\Index;
use Drupal\user\UserInterface;
use Drupal\views\Plugin\views\exposed_form\ExposedFormPluginInterface;
use Drupal\views\ViewExecutable;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Yaml\Yaml;

/**
 * The ticket lists filter by one parent, through `?parent=<identifier>`.
 *
 * One exposed input per test: contrib keeps each processed facet in a static
 * for the rest of the process, so a second, different input in the same test
 * would read the first one's options and chip. A test that executes twice
 * repeats the same input.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketParentFacetTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;
  use ProjectsViewTestTrait;

  /**
   * The display these assertions run, the full list of the default filters.
   */
  private const DISPLAY_ID = 'page_1';

  /**
   * The slug of the reader's workspace.
   */
  private const SLUG = 'workspace-a';

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
    'views_filters_summary', 'ui_patterns', 'ui_patterns_views',
    'display_builder', 'display_builder_views', 'bb_core',
  ];

  /**
   * A member of workspace A only.
   */
  private UserInterface $reader;

  /**
   * The fixture tickets, keyed by title.
   *
   * @var array<string, \Drupal\bb_core\Entity\BbTicketInterface>
   */
  private array $tickets = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installReadScopeEnvironment();
    $this->installConfig(['search_api', 'views']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'display_builder']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->installShippedView('views.view.tickets');
    $this->container->get('router.builder')->rebuild();
    // The option picker and the chips are bb_theme components, and the page
    // display composes its canvas through the shipped display extender.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $shipped = Yaml::parseFile(dirname(__DIR__, 7) . '/config/sync/views.settings.yml');
    self::assertIsArray($shipped);
    $this->config('views.settings')->set('display_extenders', $shipped['display_extenders'])->save();

    $this->buildTwoWorkspaceWorld();
    $this->fixture('a', 'bb_workspace')->set('slug', self::SLUG)->save();
    $reader = $this->createAccount('parent-reader', ['view bb_ticket', 'view bb_project', 'view bb_team']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $reader, []);
    $this->reader = $reader;

    // P has child C, which has grandchild G; Q has two children. Priorities
    // let one filter leave G and both of Q's children but not C.
    $this->ticket('a', 'Parent ticket', 1);
    $this->ticket('a', 'Child ticket', 2, 'Parent ticket');
    $this->ticket('a', 'Grandchild ticket', 1, 'Child ticket');
    $this->ticket('a', 'Other parent', 1);
    $this->ticket('a', 'First of Q', 1, 'Other parent');
    $this->ticket('a', 'Second of Q', 1, 'Other parent');
    // A parent in a workspace the reader does not belong to.
    $this->ticket('b', 'Foreign parent', 1);
    $this->ticket('b', 'Foreign child', 1, 'Foreign parent');

    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    $index->indexItems();
  }

  /**
   * A parent lists its direct sub-tickets, never their own sub-tickets.
   */
  public function testParentNarrowsToDirectChildren(): void {
    self::assertSame(['Child ticket'], $this->rows(['parent' => $this->key('Parent ticket')]));
  }

  /**
   * The parent filter holds one value: a pick submits one radio.
   *
   * The `or` facet keeps offering the other parents while one is chosen, so
   * the next pick replaces it.
   */
  public function testSecondPickReplacesTheFirst(): void {
    $other = $this->key('Other parent');
    self::assertSame(['First of Q', 'Second of Q'], $this->rows(['parent' => $other]));

    $picker = $this->picker(['parent' => $other]);
    self::assertFalse($picker['#props']['multiple']);
    self::assertSame([$other], $picker['#props']['values']);
    $list = $picker['#slots']['options']['#props'];
    self::assertSame('radio', $list['input_type']);
    self::assertSame('parent', $list['input_name']);
    $offered = array_column($list['options'], 'selected', 'value');
    self::assertTrue($offered[$other]);
    self::assertFalse($offered[$this->key('Parent ticket')], 'Another parent stays offered for the next pick.');
  }

  /**
   * The chip names the parent by key and title and removes the filter.
   */
  public function testChipShowsKeyAndTitleAndRemoves(): void {
    $key = $this->key('Parent ticket');
    $html = $this->screen('parent=' . $key);

    self::assertStringContainsString('Parent is ' . $key . ' · Parent ticket', $this->chipText($html));
    $href = $this->removeHref($html, 'Parent');
    self::assertStringNotContainsString('parent', $href, 'Removing the chip keeps the parent filter.');
    self::assertSame('/' . self::SLUG . '/tickets/all', $href);
  }

  /**
   * The chip names the parent even when no listed ticket has a parent.
   *
   * No ticket is in review, so the parent facet has no results at all and
   * contrib states no chip for it; the chosen parent is still named and
   * removable, as the picker keeps its row.
   */
  public function testChipSurvivesAnEmptyFacet(): void {
    $key = $this->key('Parent ticket');
    $html = $this->screen('parent=' . $key . '&state[]=review');

    self::assertStringContainsString('Parent is ' . $key . ' · Parent ticket', $this->chipText($html));
    self::assertSame('/' . self::SLUG . '/tickets/all?state[]=review', $this->removeHref($html, 'Parent'));
  }

  /**
   * A key that does not exist or is not readable lists nothing, named by key.
   */
  #[DataProvider('unknownOrUnreadableParents')]
  public function testUnknownOrUnreadableParent(string $parent): void {
    $key = isset($this->tickets[$parent]) ? $this->key($parent) : $parent;
    self::assertSame([], $this->rows(['parent' => $key]));

    $html = $this->screen('parent=' . $key);
    $chips = $this->chipText($html);
    self::assertStringContainsString('Parent is ' . $key, $chips);
    self::assertStringNotContainsString('Parent is ' . $key . ' ·', $chips);
    self::assertStringNotContainsString('Foreign parent', $html, 'The screen discloses a title the reader may not read.');
    self::assertStringNotContainsString('parent', $this->removeHref($html, 'Parent'));
  }

  /**
   * A key nothing carries, and a parent of a workspace the reader is not in.
   *
   * @return array<string, array{string}>
   *   A literal key, or the title of the fixture whose key is used.
   */
  public static function unknownOrUnreadableParents(): array {
    return [
      'missing' => ['NOPE-9'],
      'foreign' => ['Foreign parent'],
    ];
  }

  /**
   * The picker offers the parents of the listed tickets, with child counts.
   *
   * Priority 1 leaves G and both of Q's children but not C, so P is no
   * parent of any listed ticket and is not offered.
   */
  public function testParentOptionsCountChildren(): void {
    $picker = $this->picker(['priority' => ['1']]);

    $options = [];
    foreach ($picker['#slots']['options']['#props']['options'] as $option) {
      $options[$option['value']] = [$option['label'], $option['count'] ?? NULL];
    }
    ksort($options);
    $child = $this->key('Child ticket');
    $other = $this->key('Other parent');
    $expected = [
      $child => [$child . ' · Child ticket', '1'],
      $other => [$other . ' · Other parent', '2'],
    ];
    ksort($expected);
    self::assertSame($expected, $options);
    self::assertTrue($picker['#props']['searchable'], 'The parent is found by typing its key or title.');
    self::assertArrayNotHasKey(
      'quick_choices',
      $picker['#slots']['options']['#props'],
      'Only the state facet offers "Only open states".',
    );
  }

  /**
   * Creates a ticket on one side of the world, optionally under a parent.
   */
  private function ticket(string $side, string $title, int $priority, ?string $parent = NULL): void {
    $ticket = $this->createEntity('bb_ticket', [
      'title' => $title,
      'workflow' => 'bb_work',
      'priority' => $priority,
      'project_id' => $this->fixture($side, 'bb_project')->id(),
      'parent_id' => $parent === NULL ? NULL : $this->tickets[$parent]->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $this->tickets[$title] = $ticket;
  }

  /**
   * The identifier of one fixture ticket, which is its `?parent=` value.
   */
  private function key(string $title): string {
    return $this->tickets[$title]->getIdentifier();
  }

  /**
   * The executed view for one exposed input, as the reader.
   *
   * @param array<string, mixed> $input
   *   The exposed input.
   */
  private function executed(array $input): ViewExecutable {
    $this->container->get('account_switcher')->switchTo($this->reader);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $view = Views::getView('tickets');
    self::assertInstanceOf(ViewExecutable::class, $view);
    self::assertTrue($view->setDisplay(self::DISPLAY_ID));
    $view->setExposedInput($input);
    $view->preExecute([self::SLUG]);
    $view->execute(self::DISPLAY_ID);
    return $view;
  }

  /**
   * The titles of the listed tickets, sorted.
   *
   * @param array<string, mixed> $input
   *   The exposed input.
   *
   * @return array<int, string>
   *   The titles.
   */
  private function rows(array $input): array {
    $titles = [];
    foreach ($this->executed($input)->result as $row) {
      $object = $row->_object ?? NULL;
      $ticket = $object instanceof ComplexDataInterface ? $object->getValue() : NULL;
      if ($ticket instanceof BbTicketInterface) {
        $titles[] = (string) $ticket->label();
      }
    }
    sort($titles);
    return $titles;
  }

  /**
   * The parent facet's option picker render array.
   *
   * @param array<string, mixed> $input
   *   The exposed input.
   *
   * @return array<string, mixed>
   *   The `bb_theme:option_picker` element.
   */
  private function picker(array $input): array {
    $exposed_form = $this->executed($input)->display_handler->getPlugin('exposed_form');
    self::assertInstanceOf(ExposedFormPluginInterface::class, $exposed_form);
    $form = $exposed_form->renderExposedForm(TRUE);
    self::assertArrayHasKey('parent', $form, 'The parent facet is not in the exposed form.');
    return $form['parent'];
  }

  /**
   * The screen a request for one query string renders, as the reader.
   */
  private function screen(string $query): string {
    $this->container->get('account_switcher')->switchTo($this->reader);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $request = Request::create('/' . self::SLUG . '/tickets/all?' . $query);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add($this->container->get('router')->matchRequest($request));
    $this->container->get('request_stack')->push($request);
    try {
      $view = Views::getView('tickets');
      self::assertInstanceOf(ViewExecutable::class, $view);
      $build = $view->buildRenderable(self::DISPLAY_ID, [self::SLUG]);
      return (string) $this->container->get('renderer')->renderInIsolation($build);
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * The chip strip's text, whitespace-collapsed.
   */
  private function chipText(string $html): string {
    $start = strpos($html, 'data-active-filters="chips"');
    self::assertNotFalse($start, 'The screen has no chips container.');
    $end = strpos($html, '</div>', $start);
    self::assertNotFalse($end);
    return trim((string) preg_replace('/\s+/', ' ', strip_tags(substr($html, $start, $end - $start))));
  }

  /**
   * The address one chip's remove control links to.
   */
  private function removeHref(string $html, string $field): string {
    $document = new \DOMDocument();
    @$document->loadHTML($html);
    $links = (new \DOMXPath($document))->query(sprintf('//a[@aria-label="Remove the %s filter"]', $field));
    self::assertInstanceOf(\DOMNodeList::class, $links);
    $link = $links->item(0);
    self::assertInstanceOf(\DOMElement::class, $link, "The $field chip has no remove control.");
    return $link->getAttribute('href');
  }

}
