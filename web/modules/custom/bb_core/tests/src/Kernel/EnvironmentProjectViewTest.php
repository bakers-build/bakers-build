<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The project Environments tab lists the environments of the URL's project.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EnvironmentProjectViewTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;
  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'views', 'better_exposed_filters',
    'ui_patterns', 'ui_patterns_views', 'display_builder', 'display_builder_views', 'island',
    'bb_core',
  ];

  /**
   * A second project with its own environment in workspace A.
   */
  private ContentEntityInterface $secondProject;

  /**
   * A lead of both workspaces.
   */
  private UserInterface $lead;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    foreach (['a', 'b'] as $side) {
      $this->fixture($side, 'bb_workspace')->set('slug', "space-$side")->save();
    }
    $this->secondProject = $this->createEntity('bb_project', [
      'name' => 'another-a',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
      'teams' => [$this->fixture('a', 'bb_team')->id()],
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $this->createEntity('bb_environment', [
      'name' => 'env-another-a',
      'project_id' => $this->secondProject->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $this->installConfig(['views']);
    $this->installShippedView('views.view.bb_environments');
    $this->container->get('router.builder')->rebuild();

    $this->lead = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->lead, ['lead']);
    $this->addMembership($this->fixture('b', 'bb_workspace'), $this->lead, ['lead']);
    $this->container->get('current_user')->setAccount($this->lead);
  }

  /**
   * Only the URL project's environments.
   */
  public function testListsTheUrlProjectOnly(): void {
    $project = (string) $this->fixture('a', 'bb_project')->id();
    self::assertSame(['env-a'], $this->names($this->viewResultIds('bb_environments', ['space-a', $project], 'project_list')));
    $second = ['space-a', (string) $this->secondProject->id()];
    self::assertSame(['env-another-a'], $this->names($this->viewResultIds('bb_environments', $second, 'project_list')));
  }

  /**
   * The environment names of the given ids.
   *
   * @param array<int, string> $ids
   *   Environment ids.
   *
   * @return array<int, string>
   *   Their names, in the given order.
   */
  private function names(array $ids): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_environment');
    return array_values(array_map(static fn ($environment): string => (string) $environment->label(), $storage->loadMultiple($ids)));
  }

}
