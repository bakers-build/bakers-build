<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Entity\BbFigure;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Resource\StatisticsResource;
use Drupal\bb_core\Statistics\Figure\FigureCollection;
use Drupal\jsonapi\JsonApiResource\ResourceObject;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * A person's figures shown to someone else cover only projects they may see.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class UserFigureProjectBoundTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use InsightsFixtureTrait;

  private const NOW = 1789920000;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine', 'field', 'og',
    'link', 'text', 'serialization', 'jsonapi', 'jsonapi_resources', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_conductor', 'bb_ticket', 'bb_comment',
      'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user', 'jsonapi']);
    $this->installOgScopeFixture();
    $this->account('uid1-dummy');
    $this->installMyWorkFigures();
  }

  /**
   * A lead of A sees U's projects of A only; U still sees both.
   */
  public function testLeadSeesNoProjectOfAnotherWorkspace(): void {
    $etm = $this->container->get('entity_type.manager');
    $a = $this->workspace('alpha');
    $b = $this->workspace('beta');
    $team = $etm->getStorage('bb_team')->create(['name' => 'alpha-team', 'workspace_id' => $a->id()]);
    $team->save();

    $lead = $this->account('lead');
    $this->addMembership($a, $lead, ['contributor']);
    $this->addMembership($team, $lead, ['lead']);

    $target = $this->account('target');
    $this->addMembership($a, $target, ['contributor']);
    $this->addMembership($team, $target);
    $this->addMembership($b, $target, ['contributor']);

    $alpha = $this->project($a, 'alpha-visible');
    $alpha->set('teams', [$team->id()])->save();
    $this->closedTicket($alpha, $target);
    $this->closedTicket($this->project($b, 'beta-secret'), $target);

    self::assertSame(['alpha-visible'], $this->projectRows($target, $lead));
    self::assertSame(['alpha-visible', 'beta-secret'], $this->projectRows($target, $target));
    self::assertSame(['alpha-visible'], $this->resourceRows($target, $lead));
  }

  /**
   * The project rows of `user_projects` from the direct JSON:API resource.
   *
   * @return list<string>
   *   The project labels, sorted.
   */
  private function resourceRows(UserInterface $target, UserInterface $viewer): array {
    $this->container->get('current_user')->setAccount($viewer);
    $resource = StatisticsResource::create($this->container);
    $resource->setResourceResponseFactory($this->container->get('jsonapi_resources.resource_response_factory'));
    $this->container->get('router.builder')->rebuild();
    $route = $this->container->get('router.route_provider')->getRouteByName('bb_core.statistics.item');
    $request = Request::create('/', 'GET', ['user_id' => $target->uuid(), 'filter' => ['period' => 'all']]);
    $figure = BbFigure::load('user_projects');
    self::assertInstanceOf(BbFigure::class, $figure);
    $object = $resource->process($request, $figure, $resource->getRouteResourceTypes($route, 'bb_core.statistics.item'))
      ->getResponseData()->getData()->getIterator()->current();
    self::assertInstanceOf(ResourceObject::class, $object);
    $labels = array_column($object->getField('categories'), 'label');
    sort($labels);
    return $labels;
  }

  /**
   * The project rows of `user_projects` for a target, as a viewer gets them.
   *
   * @return list<string>
   *   The project labels, sorted.
   */
  private function projectRows(UserInterface $target, UserInterface $viewer): array {
    $collection = $this->container->get('bb_core.figure_collection');
    self::assertInstanceOf(FigureCollection::class, $collection);
    foreach ($collection->groups(['user' => $target], $viewer, ['period' => 'all'], self::NOW) as $group) {
      foreach ($group['figures'] as $figure) {
        if ($figure['id'] === 'user_projects') {
          $labels = array_column($figure['categories'], 'label');
          sort($labels);
          return $labels;
        }
      }
    }
    self::fail('user_projects is not disclosed to the viewer.');
  }

  /**
   * Creates a workspace.
   */
  private function workspace(string $name): BbWorkspaceInterface {
    $ws = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create(['name' => $name]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $ws);
    $ws->save();
    return $ws;
  }

  /**
   * Creates a project in its own group of a workspace.
   */
  private function project(BbWorkspaceInterface $ws, string $name): BbProjectInterface {
    $etm = $this->container->get('entity_type.manager');
    $group = $etm->getStorage('bb_group')->create(['name' => $name . '-group', 'workspace_id' => $ws->id()]);
    $group->save();
    $project = $etm->getStorage('bb_project')->create(['name' => $name, 'group_id' => $group->id()]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Creates an active account.
   */
  private function account(string $name): UserInterface {
    $account = $this->container->get('entity_type.manager')->getStorage('user')->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $account);
    $account->save();
    return $account;
  }

  /**
   * Creates a ticket closed a day before NOW.
   */
  private function closedTicket(BbProjectInterface $project, UserInterface $assignee): void {
    $closed = self::NOW - 86400;
    $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'closed-' . $project->label(),
      'project_id' => $project->id(),
      'assignee_user_id' => $assignee->id(),
      'created' => $closed,
      'closed' => TRUE,
      'closed_date' => $closed,
    ])->save();
  }

}
