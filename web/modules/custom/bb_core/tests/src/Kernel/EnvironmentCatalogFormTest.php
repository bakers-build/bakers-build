<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\bb_core\Form\BbEnvironmentForm;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\InputBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Adding and deleting an environment from the Catalog Environments tab.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EnvironmentCatalogFormTest extends KernelTestBase {

  use UserCreationTrait;
  use WorkspaceReadScopeTestTrait;

  private const ADD_ROUTE = 'entity.bb_environment.add_for_workspace';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'island', 'bb_core',
  ];

  /**
   * A lead of workspace A.
   */
  private UserInterface $lead;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->installConfig(['system']);
    $this->buildTwoWorkspaceWorld();
    foreach (['a', 'b'] as $side) {
      $this->fixture($side, 'bb_workspace')->set('slug', "space-$side")->save();
    }
    $this->container->get('router.builder')->rebuild();

    $this->lead = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->lead, ['lead']);
    $this->setCurrentUser($this->lead);
  }

  /**
   * The add route sits on the tab and needs the create right in its workspace.
   */
  public function testAddNeedsTheCreateRightInThatWorkspace(): void {
    $route = $this->container->get('router.route_provider')->getRouteByName(self::ADD_ROUTE);
    self::assertSame('/_workspace/{bb_workspace}/catalog/environments/add', $route->getPath());

    $contributor = $this->createAccount('north-contributor');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $contributor, ['contributor']);
    $url = static fn (string $slug): Url => Url::fromRoute(self::ADD_ROUTE, ['bb_workspace' => $slug]);

    self::assertTrue($url('space-a')->access($this->lead));
    self::assertFalse($url('space-a')->access($contributor), 'A contributor only reads environments.');
    self::assertFalse($url('space-b')->access($this->lead), 'Nor in another workspace.');
  }

  /**
   * A project of the workspace is saved and the form returns to the tab.
   */
  public function testAddSavesForAProjectOfTheWorkspace(): void {
    $project = (string) $this->fixture('a', 'bb_project')->id();
    $state = $this->submitAdd('staging', $project);

    self::assertSame([], array_map('strval', $state->getErrors()));
    $saved = $this->environments('staging');
    self::assertCount(1, $saved);
    self::assertSame($project, (string) reset($saved)->get('project_id')->target_id);
    // A programmed submission reports no redirect; read the one it set.
    $redirect = (new \ReflectionProperty(FormState::class, 'redirect'))->getValue($state);
    self::assertInstanceOf(Url::class, $redirect);
    self::assertSame('view.bb_environments.catalog', $redirect->getRouteName());
  }

  /**
   * A project of another workspace is refused; nothing is saved.
   */
  public function testAddRejectsAProjectOfAnotherWorkspace(): void {
    $state = $this->submitAdd('foreign', (string) $this->fixture('b', 'bb_project')->id());

    self::assertNotSame([], $state->getErrors());
    self::assertSame([], $this->environments('foreign'));
  }

  /**
   * Deleting an environment returns to the Environments tab.
   */
  public function testDeleteReturnsToTheTab(): void {
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_environment', 'delete');
    self::assertInstanceOf(BbContentEntityDeleteForm::class, $form);
    $form->setEntity($this->fixture('a', 'bb_environment'));

    $url = (new \ReflectionMethod($form, 'getRedirectUrl'))->invoke($form);

    self::assertSame('view.bb_environments.catalog', $url->getRouteName());
  }

  /**
   * Submits the workspace add form of workspace A.
   */
  private function submitAdd(string $name, string $project): FormStateInterface {
    $route = $this->container->get('router.route_provider')->getRouteByName(self::ADD_ROUTE);
    $request = Request::create('/add', 'GET');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add([
      RouteObjectInterface::ROUTE_NAME => self::ADD_ROUTE,
      RouteObjectInterface::ROUTE_OBJECT => $route,
      'bb_workspace' => $this->fixture('a', 'bb_workspace'),
      '_raw_variables' => new InputBag(['bb_workspace' => 'space-a']),
    ]);
    $this->container->get('request_stack')->push($request);
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_environment', 'add');
    self::assertInstanceOf(BbEnvironmentForm::class, $form);
    $form->setEntity($form->getEntityFromRouteMatch($this->container->get('current_route_match'), 'bb_environment'));
    $state = (new FormState())->setValues([
      'name' => [['value' => $name]],
      'project_id' => $project,
      'op' => 'Save',
    ]);
    $this->container->get('form_builder')->submitForm($form, $state);
    return $state;
  }

  /**
   * The environments with the given name.
   *
   * @return array<int|string, \Drupal\Core\Entity\EntityInterface>
   *   The matching environments.
   */
  private function environments(string $name): array {
    return $this->container->get('entity_type.manager')->getStorage('bb_environment')->loadByProperties(['name' => $name]);
  }

}
