<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Kernel;

use Drupal\Tests\bb_core\Kernel\ProjectsViewTestTrait;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_board\ProjectBoard;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_board\Plugin\views\area\BbBoardSummary;
use Drupal\search_api\Entity\Index;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The Board filter bar renders as one toolbar row, with the Board's marks.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectBoardFilterBarTest extends KernelTestBase {

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
    'display_builder', 'ui_patterns', 'ui_patterns_views',
    'display_builder_views',
    'bb_core', 'bb_activity', 'bb_board',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installSchema('user', ['users_data']);
    $this->installEntitySchema('bb_activity');
    $this->installReadScopeEnvironment();
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->installShippedView('views.view.project_board');
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->container->get('theme.manager')->setActiveTheme(
      $this->container->get('theme.initialization')->initTheme('bb_theme'),
    );
    $this->buildTwoWorkspaceWorld();
    $this->fixture('a', 'bb_ticket')->set('priority', 1)->save();
    Index::load('bb_tickets')?->indexItems();
  }

  /**
   * State and Priority are pills in the one toolbar row, never stacked fields.
   */
  public function testStateAndPriorityArePillsInTheToolbar(): void {
    $build = $this->summary()->render();
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);

    self::assertSame(1, preg_match('#<div[^>]*role="search"[^>]*aria-label="Board filters"[\s\S]*#', $html, $match));
    $bar = $match[0];
    foreach (['State', 'Priority'] as $field) {
      self::assertMatchesRegularExpression(
        '#data-option-picker\s+data-option-picker-label="' . $field . '"\s+data-option-picker-variant="field"#',
        $bar,
        "$field is a pill.",
      );
    }
    self::assertStringNotContainsString('data-option-picker-variant="facet"', $bar, 'No stacked full-width facet field.');
    self::assertStringNotContainsString('<select', $bar);
    self::assertMatchesRegularExpression('#data-picker-part="icon"[\s\S]*data-picker-part="field"[^>]*>State<#', $bar);
    self::assertMatchesRegularExpression('#data-value="1">(?:(?!</li>)[\s\S])*tabular-nums[^>]*>1</span>#', $bar, 'Options keep their counts.');
  }

  /**
   * A person has one mark on the Board: the bar's avatar is the card's.
   */
  public function testFilterBarAvatarMatchesTheCardAvatar(): void {
    // A one-word name and an id where the two old palettes disagree.
    $person = $this->createAccount('baker');
    while ((int) $person->id() % 5 < 2) {
      $person = $this->createAccount('baker' . $person->id());
    }
    $ticket = $this->fixture('a', 'bb_ticket');
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->set('assignee_user_id', $person->id())->save();
    Index::load('bb_tickets')?->indexItems();

    $rows = array_values(array_filter(
      $this->summary()->summary()['employees'],
      static fn (array $row): bool => $row['value'] === (string) $person->id(),
    ));
    self::assertCount(1, $rows);
    $card = $this->container->get(ProjectBoard::class)->cards([$ticket])[0];
    self::assertSame($rows[0]['initials'], $card['assignee_initials']);
    self::assertSame($rows[0]['color'], $card['assignee_color']);
  }

  /**
   * The executed Board page's summary area, read as a project member.
   */
  private function summary(): BbBoardSummary {
    $reader = $this->createAccount('bar-reader', ['view bb_ticket', 'view bb_project', 'view bb_conductor']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $reader, []);
    $this->container->get('current_user')->setAccount($reader);

    $view = Views::getView('project_board');
    self::assertNotNull($view);
    $arguments = [(string) $this->fixture('a', 'bb_workspace')->id(), (string) $this->fixture('a', 'bb_project')->id()];
    self::assertTrue($view->setDisplay('project_board'));
    $view->setArguments($arguments);
    $view->preExecute($arguments);
    $view->execute('project_board');
    $handler = $view->header['bb_board_summary'] ?? NULL;
    self::assertInstanceOf(BbBoardSummary::class, $handler);
    return $handler;
  }

}
