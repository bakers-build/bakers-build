<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbMenuSource;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The rail with the shipped tickets, groups and projects views.
 *
 * My work's route belongs to the shipped tickets view, so this class installs
 * the search stack that view needs. The URL is asserted as the public one,
 * `/{slug}/tickets`.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbRailMyWorkTest extends KernelTestBase {

  use UserCreationTrait;
  use ProjectsViewTestTrait;
  use RailRequestTrait;
  use OgScopeFixtureTrait;

  /**
   * The scoped list the My work entry points at.
   */
  private const TICKETS_ROUTE = 'view.tickets.my_work';

  /**
   * The full ticket table, which is not the nav home.
   */
  private const ALL_TICKETS_ROUTE = 'view.tickets.page_1';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'ui_patterns', 'bb_core',
    // The shipped tickets view and its dependencies.
    'views', 'better_exposed_filters', 'search_api', 'search_api_db',
    'facets', 'facets_exposed_filters', 'views_filters_summary',
    'display_builder', 'ui_patterns_views', 'display_builder_views',
  ];

  /**
   * The ambient workspace.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * A second workspace, created up front.
   *
   * The path processor memoises the slug set per request.
   */
  private BbWorkspaceInterface $rival;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_team');
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('bb_ticket');
    $this->installEntitySchema('search_api_task');
    $this->installConfig(['system', 'user', 'search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    $this->installShippedView('views.view.tickets');
    $this->installShippedView('views.view.projects');
    $this->installShippedView('views.view.groups');

    // Root, so that access is never the reason the entry is absent.
    $this->setUpCurrentUser(['uid' => 1]);

    $this->container->get('router.builder')->rebuild();

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_workspace');
    foreach (['workspace' => 'acme', 'rival' => 'rival'] as $property => $slug) {
      $workspace = $storage->create(['name' => ucfirst($slug), 'slug' => $slug]);
      $workspace->save();
      self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
      $this->{$property} = $workspace;
    }

    $this->visit(self::TICKETS_ROUTE, ['bb_workspace' => 'acme']);
  }

  /**
   * My work points at the ambient workspace and keeps its icon.
   */
  public function testTheRailCarriesMyWorkAtTheAmbientWorkspace(): void {
    self::assertSame('/acme/tickets', $this->myWork()['url']);
    self::assertSame('ticket', $this->myWork()['icon']);
  }

  /**
   * My work is current on its own route.
   */
  public function testMyWorkIsTheActiveEntryOnItsOwnRoute(): void {
    self::assertTrue($this->myWork()['in_active_trail']);
  }

  /**
   * A team page is not the nav home.
   */
  public function testMyWorkIsNotActiveOnAnotherWorkspaceRoute(): void {
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 'Crew', 'workspace_id' => $this->workspace->id()]);
    $team->save();

    $this->visit('bb_core.bb_team.members', ['bb_workspace' => 'acme', 'bb_team' => $team->id()]);

    self::assertFalse($this->myWork()['in_active_trail']);
  }

  /**
   * The full ticket table is not the nav home.
   */
  public function testMyWorkIsNotActiveOnTheFullTicketTable(): void {
    $this->visit(self::ALL_TICKETS_ROUTE, ['bb_workspace' => 'acme']);

    self::assertSame('/acme/tickets', $this->myWork()['url']);
    self::assertFalse($this->myWork()['in_active_trail']);
  }

  /**
   * The link follows the workspace the request is on.
   */
  public function testTheLinkFollowsTheWorkspaceTheRequestIsOn(): void {
    $this->visit(self::TICKETS_ROUTE, ['bb_workspace' => 'rival']);

    self::assertSame('/rival/tickets', $this->myWork()['url']);
    self::assertTrue($this->myWork()['in_active_trail']);
  }

  /**
   * Off a workspace route there is no workspace to link to.
   */
  public function testTheEntryIsAbsentWithNoAmbientWorkspace(): void {
    $this->visit('entity.bb_workspace.collection');

    self::assertNotContains('My work', array_column($this->emitted(), 'title'));
  }

  /**
   * Navigation precedes the Teams heading, even before a team exists.
   */
  public function testNavigationPrecedesTheTeamCreateHeading(): void {
    self::assertSame(['My work', 'Groups', 'Projects', 'Insights', 'Teams'], array_column($this->emitted(), 'title'));
  }

  /**
   * Each rank sees the rows its route access allows, in the shipped order.
   *
   * The gates are the sitemap's: Settings needs `bb_workspace.update`
   * (lead only), Insights the lead's figure permission in this workspace, the
   * rest workspace membership. A member of another
   * workspace sees no workspace row at all.
   */
  public function testEachRankSeesItsRows(): void {
    $this->installOgScopeFixture();
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 'Platform Crew', 'workspace_id' => $this->workspace->id()]);
    $team->save();

    $expected = [
      'lead' => ['My work', 'Groups', 'Projects', 'Insights', 'Settings', 'Teams'],
      'contributor' => ['My work', 'Groups', 'Projects', 'Teams'],
      'guest' => ['My work', 'Groups', 'Projects', 'Teams'],
      'non-member' => [],
    ];
    $actual = [];
    foreach (array_keys($expected) as $rank) {
      $account = $this->createUser([], $rank);
      self::assertInstanceOf(UserInterface::class, $account);
      if ($rank === 'non-member') {
        $this->addMembership($this->rival, $account, ['contributor']);
      }
      else {
        $this->addMembership($this->workspace, $account, [$rank]);
        $this->addMembership($team, $account, ['member']);
      }
      $this->setCurrentUser($account);
      $this->visit(self::TICKETS_ROUTE, ['bb_workspace' => 'acme']);
      $actual[$rank] = array_column($this->emitted(), 'title');
    }

    self::assertSame($expected, $actual);
  }

  /**
   * The My work entry of the emitted value.
   *
   * @return array<string, mixed>
   *   The My work item.
   */
  private function myWork(): array {
    $by_title = array_column($this->emitted(), NULL, 'title');
    self::assertArrayHasKey('My work', $by_title);
    return $by_title['My work'];
  }

  /**
   * The source's emitted value on the current route.
   *
   * @return array<int, array<string, mixed>>
   *   Link items in the `links` vocabulary.
   */
  private function emitted(): array {
    $prop_definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('links')['schema'];
    $configuration = SourcePluginBase::buildConfiguration('items', $prop_definition, ['source' => ['menu' => 'bakers-rail']], []);
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_menu', $configuration);
    self::assertInstanceOf(BbMenuSource::class, $source);
    $value = $source->getPropValue();
    self::assertIsArray($value);
    return array_values($value);
  }

}
