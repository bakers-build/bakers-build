<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\Core\Config\FileStorage;
use Drupal\user\Entity\Role;

/**
 * Installs the shipped Insights measurements, figures and figure group.
 */
trait InsightsFixtureTrait {

  /**
   * The shipped workspace figures, in group order.
   */
  private const INSIGHTS_FIGURES = [
    'workspace_overview',
    'workspace_flow',
    'workspace_models',
    'workspace_projects_tokens',
    'workspace_projects',
    'workspace_people',
  ];

  /**
   * The shipped Project › Stats figures, in group order.
   */
  private const PROJECT_STATS_FIGURES = [
    'project_overview',
    'project_flow',
    'project_people',
  ];

  /**
   * The shipped My work figures, in group order.
   */
  private const MY_WORK_FIGURES = [
    'user_overview',
    'user_flow',
    'user_projects',
    'user_tickets',
  ];

  /**
   * Installs the My work config exactly as config/sync ships it.
   *
   * Every shipped user figure is installed, so a figure that should be gone
   * would show up. The authenticated role gets its shipped figure grants.
   */
  protected function installMyWorkFigures(): void {
    $this->installInsightsFigures();
    $sync = new FileStorage(dirname($this->root) . '/config/sync');
    $storage = $this->container->get('entity_type.manager');
    foreach ($sync->listAll('bb_core.bb_figure.user_') as $name) {
      $data = $sync->read($name);
      self::assertIsArray($data);
      $storage->getStorage('bb_figure')->create($data)->save();
    }
    $group = $sync->read('bb_core.bb_figure_group.my_work');
    self::assertIsArray($group, 'config/sync ships the my_work group.');
    self::assertSame(self::MY_WORK_FIGURES, $group['figures']);
    $storage->getStorage('bb_figure_group')->create($group)->save();
    $role = $sync->read('user.role.authenticated');
    self::assertIsArray($role);
    $authenticated = Role::load('authenticated');
    self::assertNotNull($authenticated);
    foreach ($role['permissions'] as $permission) {
      if (str_starts_with($permission, 'view bakers figure ')) {
        $authenticated->grantPermission($permission);
      }
    }
    $authenticated->save();
  }

  /**
   * Installs the Insights config exactly as config/sync ships it.
   */
  protected function installInsightsFigures(): void {
    $sync = new FileStorage(dirname($this->root) . '/config/sync');
    $storage = $this->container->get('entity_type.manager');
    foreach ([
      'closed_tickets', 'created_tickets', 'open_tickets', 'runs', 'run_tokens',
      'rated_tickets', 'job_rating', 'closed_tickets_many_runs',
      'runs_per_ticket', 'tokens_per_ticket',
    ] as $id) {
      $data = $sync->read("bb_core.bb_measurement.$id");
      self::assertIsArray($data, "config/sync ships $id.");
      $storage->getStorage('bb_measurement')->create($data)->save();
    }
    foreach ([...self::INSIGHTS_FIGURES, ...self::PROJECT_STATS_FIGURES] as $id) {
      $data = $sync->read("bb_core.bb_figure.$id");
      self::assertIsArray($data, "config/sync ships $id.");
      $storage->getStorage('bb_figure')->create($data)->save();
    }
    $group = $sync->read('bb_core.bb_figure_group.insights');
    self::assertIsArray($group);
    self::assertSame([...self::INSIGHTS_FIGURES, ...self::PROJECT_STATS_FIGURES], $group['figures']);
    $storage->getStorage('bb_figure_group')->create($group)->save();
  }

}
