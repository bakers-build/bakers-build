<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The figures tabs read Insights, like the page they open, at `…/stats`.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class InsightsTabLabelTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'bb_core', 'views',
  ];

  /**
   * Local task id => the path its route keeps.
   */
  private const TASKS = [
    'bb_core.my_work.stats' => '/_workspace/{bb_workspace}/stats',
    'bb_core.bb_project.stats' => '/_workspace/{bb_workspace}/project/{bb_project}/stats',
    'bb_core.bb_team.stats' => '/_workspace/{bb_workspace}/team/{bb_team}/stats',
  ];

  /**
   * Each tab and the My work page title say Insights; paths stay.
   */
  public function testStatsTabsAreCalledInsights(): void {
    $tasks = $this->container->get('plugin.manager.menu.local_task')->getDefinitions();
    $routes = $this->container->get('router.route_provider');
    foreach (self::TASKS as $id => $path) {
      self::assertSame('Insights', (string) ($tasks[$id]['title'] ?? ''), "$id title");
      self::assertSame($path, $routes->getRouteByName($tasks[$id]['route_name'])->getPath(), "$id path");
    }
    self::assertSame('Insights', $routes->getRouteByName('bb_core.my_work.stats')->getDefault('_title'));
  }

}
