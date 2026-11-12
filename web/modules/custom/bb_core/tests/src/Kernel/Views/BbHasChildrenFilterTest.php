<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Views;

use Drupal\Core\TypedData\ComplexDataInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\search_api\Entity\Index;
use Drupal\views\ViewExecutable;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The "Has sub-tickets" filter lists the parents themselves.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbHasChildrenFilterTest extends KernelTestBase {

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
    'display_builder', 'display_builder_views', 'bb_core',
  ];

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
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->installShippedView('views.view.tickets');
    $this->container->get('router.builder')->rebuild();
    $this->buildTwoWorkspaceWorld();
    $reader = $this->createAccount('children-reader', ['view bb_ticket', 'view bb_project', 'view bb_team']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $reader, []);
    $this->container->get('account_switcher')->switchTo($reader);

    // P > C > G and Q > D: P, C and Q have sub-tickets, in two states.
    $this->ticket('P', 'working');
    $this->ticket('C', 'working', 'P');
    $this->ticket('G', 'working', 'C');
    $this->ticket('Q', 'review');
    $this->ticket('D', 'working', 'Q');
    Index::load('bb_tickets')->indexItems();
  }

  /**
   * Switched on, only tickets with at least one sub-ticket are listed.
   */
  public function testOnlyTicketsWithSubTickets(): void {
    self::assertSame(['C', 'P', 'Q'], $this->rows(['has_children' => '1']));
    self::assertContains('G', $this->rows([]), 'Switched off, the filter narrows nothing.');
  }

  /**
   * It narrows together with the parent and the state filters.
   */
  public function testCombinesWithParentAndState(): void {
    $parent = $this->tickets['P']->getIdentifier();
    self::assertSame(['C'], $this->rows(['has_children' => '1', 'parent' => $parent]));
    self::assertSame(['Q'], $this->rows(['has_children' => '1', 'state' => ['review']]));
  }

  /**
   * Creates a ticket on workspace A's project, optionally under a parent.
   */
  private function ticket(string $title, string $state, ?string $parent = NULL): void {
    $ticket = $this->createEntity('bb_ticket', [
      'title' => $title,
      'workflow' => 'bb_work',
      'state' => $state,
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'parent_id' => $parent === NULL ? NULL : $this->tickets[$parent]->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $this->tickets[$title] = $ticket;
  }

  /**
   * The titles the full list shows for one exposed input, sorted.
   *
   * @param array<string, mixed> $input
   *   The exposed input.
   *
   * @return array<int, string>
   *   The titles.
   */
  private function rows(array $input): array {
    $this->container->get('bb_core.workspace_read_scope')->reset();
    $view = Views::getView('tickets');
    self::assertInstanceOf(ViewExecutable::class, $view);
    self::assertTrue($view->setDisplay('page_1'));
    $view->setExposedInput($input);
    $view->preExecute(['workspace-a']);
    $view->execute('page_1');
    $titles = [];
    foreach ($view->result as $row) {
      $object = $row->_object ?? NULL;
      $ticket = $object instanceof ComplexDataInterface ? $object->getValue() : NULL;
      if ($ticket instanceof BbTicketInterface) {
        $titles[] = (string) $ticket->label();
      }
    }
    sort($titles);
    return $titles;
  }

}
