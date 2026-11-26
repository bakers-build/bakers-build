<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\ui_patterns\SourcePluginBase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Routing\Route;

/**
 * The line under the shell page title: the route text, or a computed line.
 */
#[Group('bb_core')]
final class BbPageHeaderDescriptionSourceTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'markdown_easy', 'og', 'state_machine', 'views', 'island',
    'ui_patterns', 'bb_core',
  ];

  /**
   * A project with a key and a group.
   */
  private BbProjectInterface $project;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team', 'bb_project'] as $type) {
      $this->installEntitySchema($type);
    }
    $storage = $this->container->get('entity_type.manager');
    $workspace = $storage->getStorage('bb_workspace')->create(['name' => 'A', 'slug' => 'workspace-a']);
    $workspace->save();
    $group = $storage->getStorage('bb_group')->create(['name' => 'Acme', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $storage->getStorage('bb_project')->create([
      'name' => 'Project',
      'key' => 'PRJ',
      'group_id' => $group->id(),
    ]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;
  }

  /**
   * A project tab shows its route text, not the key and group caption.
   */
  public function testAProjectTabShowsItsOwnDescription(): void {
    $route = new Route('/_workspace/{bb_workspace}/project/{bb_project}/board', [
      '_description' => 'The tickets of this project, in one column per state.',
    ]);
    $value = $this->describe('view.project_board.project_board', $route);
    self::assertSame('The tickets of this project, in one column per state.', $value);
    self::assertStringNotContainsString('prefix', $value);
  }

  /**
   * The project page keeps its key and group caption.
   */
  public function testTheProjectPageKeepsKeyAndGroup(): void {
    $route = new Route('/_workspace/{bb_workspace}/project/{bb_project}');
    self::assertSame('prefix PRJ · group Acme', $this->describe('entity.bb_project.canonical', $route));
  }

  /**
   * The source's string value on the given route, with the project.
   */
  private function describe(string $name, Route $route): string {
    $request = Request::create('/');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add([
      RouteObjectInterface::ROUTE_NAME => $name,
      RouteObjectInterface::ROUTE_OBJECT => $route,
      'bb_project' => $this->project,
    ]);
    $this->container->get('request_stack')->push($request);
    $this->container->get('current_route_match')->resetRouteMatch();
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_page_header_description', []);
    self::assertInstanceOf(SourcePluginBase::class, $source);
    return (string) $source->getPropValue();
  }

}
