<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Views;

use Drupal\Core\Form\FormState;
use Drupal\Core\TypedData\ComplexDataInterface;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\search_api\Entity\Index;
use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\user\UserInterface;
use Drupal\views\ViewExecutable;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the ticket list's exposed search over the search index.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbTicketSearchFilterTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;
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
    'views_filters_summary', 'ui_patterns', 'ui_patterns_views',
    'display_builder', 'display_builder_views', 'island', 'bb_core',
  ];

  /**
   * A member who may read workspace A's project.
   */
  private UserInterface $reader;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installReadScopeEnvironment();
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->installShippedView('views.view.tickets');
    $this->container->get('router.builder')->rebuild();

    $this->buildTwoWorkspaceWorld();
    $this->fixture('a', 'bb_project')
      ->set('repository', ['url' => 'ssh://git@git.key-tec.de/bakers-build/bakers-build.git'])->save();
    $reader = $this->createAccount('search-reader', ['view bb_ticket', 'view bb_project', 'view bb_team']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $reader, []);
    $this->reader = $reader;
  }

  /**
   * Every display that carries the search box use the ticket search.
   */
  public function testEverySearchBoxUsesTheTicketSearch(): void {
    foreach (['default', 'my_work', 'page_1', 'project_tickets', 'team_tickets'] as $display) {
      $view = Views::getView('tickets');
      $view->setDisplay($display);
      $view->initHandlers();
      self::assertSame('bb_ticket_search', $view->filter['search_api_fulltext']->getPluginId(), $display);
    }
  }

  /**
   * A short reference returns every ticket sharing that origin, and no other.
   */
  public function testShortReferenceReturnsEveryTicketSharingTheOrigin(): void {
    $first = $this->ticket('first on 20', 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/20');
    $second = $this->ticket('second on 20', 'https://git.key-tec.de/bakers-build/bakers-build/issues/20/');
    $this->ticket('on 200', 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/200');
    $this->indexTickets();

    $expected = [(int) $first->id(), (int) $second->id()];
    self::assertSame($expected, $this->ticketIds('page_1', [], 'bakers-build#20'));
    // A bare `#20` resolves through the project argument's repository.
    self::assertSame($expected, $this->ticketIds('project_tickets', [$this->fixture('a', 'bb_project')->uuid()], '#20'));
    self::assertSame($expected, $this->ticketIds('page_1', [], 'https://git.key-tec.de/bakers-build/bakers-build/-/issues/20'));
  }

  /**
   * An identifier is found, which the plain fulltext filter cannot do.
   */
  public function testIdentifierIsFound(): void {
    $ticket = $this->ticket('Theme tokens for the rail', '');
    $ticket->set('identifier', 'BB-619')->save();
    $this->indexTickets();
    $expected = [(int) $ticket->id()];
    self::assertSame($expected, $this->ticketIds('page_1', [], 'BB-619'));
    self::assertSame($expected, $this->ticketIds('page_1', [], 'bb-619'));
  }

  /**
   * A bare number finds the ticket with that number, with and without project.
   *
   * A second readable project's ticket with the same number is included when
   * there is no project in context, and excluded on the project list.
   */
  public function testBareNumberFindsTheTicketWithThatNumber(): void {
    $on_a = $this->ticket('Theme tokens for the rail', '');
    $on_b = $this->ticketOn('b', 'Same number on the other project');
    $this->grantWorkspaceB();
    $this->indexTickets();
    $number = (string) $on_a->get('number')->value;
    self::assertNotSame('', $number);
    self::assertSame($number, (string) $on_b->get('number')->value);

    $expected_a = [(int) $on_a->id()];
    $expected_both = [(int) $on_a->id(), (int) $on_b->id()];
    sort($expected_both);
    self::assertSame($expected_a, $this->ticketIds('project_tickets', [$this->fixture('a', 'bb_project')->uuid()], $number));
    self::assertSame($expected_both, $this->ticketIds('page_1', [], $number));
  }

  /**
   * Free text still searches the title.
   */
  public function testFreeTextSearchesTheTitle(): void {
    $ticket = $this->ticket('Theme tokens for the rail', '');
    $this->indexTickets();
    self::assertSame([(int) $ticket->id()], $this->ticketIds('page_1', [], 'rail'));
  }

  /**
   * An unknown alias is a form error naming the known repositories.
   */
  public function testUnknownAliasIsFormError(): void {
    $this->indexTickets();
    $this->asReader(function (): void {
      $view = Views::getView('tickets');
      $view->setDisplay('page_1');
      $view->setArguments(['workspace-a']);
      $view->initHandlers();
      $form = [];
      $form_state = new FormState();
      $form_state->setValue('title', 'nosuchrepo#1');
      $view->filter['search_api_fulltext']->validateExposed($form, $form_state);
      $errors = array_map('strval', $form_state->getErrors());
      self::assertSame(['title' => 'No repository matches "nosuchrepo". Known in your projects: bakers-build.'], $errors);
    });
    self::assertSame([], $this->ticketIds('page_1', [], 'nosuchrepo#1'));
  }

  /**
   * Creates a ticket on workspace A's project.
   */
  private function ticket(string $title, string $origin): BbTicketInterface {
    return $this->ticketOn('a', $title, $origin);
  }

  /**
   * Creates a ticket on one side of the two-workspace world.
   */
  private function ticketOn(string $side, string $title, string $origin = ''): BbTicketInterface {
    $ticket = $this->createEntity('bb_ticket', [
      'title' => $title,
      'workflow' => 'bb_work',
      'project_id' => $this->fixture($side, 'bb_project')->id(),
      'origin' => $origin,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Lets the reader read workspace B's project too.
   */
  private function grantWorkspaceB(): void {
    $this->addMembership($this->fixture('b', 'bb_workspace'), $this->reader, ['member']);
    $this->addMembership($this->fixture('b', 'bb_team'), $this->reader, []);
  }

  /**
   * Indexes every tracked ticket.
   */
  private function indexTickets(): void {
    Index::load('bb_tickets')->indexItems();
  }

  /**
   * Runs the display with the exposed search input and returns ticket ids.
   *
   * @return array<int>
   *   Sorted ticket ids.
   */
  private function ticketIds(string $display, array $arguments, string $input): array {
    return $this->asReader(function () use ($display, $arguments, $input): array {
      $arguments = ['workspace-a', ...$arguments];
      $view = Views::getView('tickets');
      self::assertInstanceOf(ViewExecutable::class, $view);
      self::assertTrue($view->setDisplay($display));
      $view->override_url = Url::fromRoute('view.tickets.my_work', ['bb_workspace' => 'workspace-a']);
      $view->setArguments($arguments);
      $view->setExposedInput(['title' => $input]);
      $view->preExecute($arguments);
      $view->execute($display);
      $ids = [];
      foreach ($view->result as $row) {
        $object = $row->_object ?? NULL;
        $ticket = $object instanceof ComplexDataInterface ? $object->getValue() : NULL;
        if ($ticket instanceof BbTicketInterface) {
          $ids[] = (int) $ticket->id();
        }
      }
      sort($ids);
      return $ids;
    });
  }

  /**
   * Runs the callback as the reader.
   */
  private function asReader(callable $callback): mixed {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($this->reader);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    try {
      return $callback();
    }
    finally {
      $switcher->switchBack();
    }
  }

}
