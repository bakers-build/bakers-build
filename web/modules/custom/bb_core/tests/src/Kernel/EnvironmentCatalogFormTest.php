<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\BbContentEntityDeleteForm;
use Drupal\bb_core\Form\BbEnvironmentForm;
use Drupal\island\Render\WrappedRouteRenderer;
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
   * The query of the add form opened as the dialog over the tab.
   */
  private const DIALOG_QUERY = [
    '_wrapper_format' => 'island_dialog',
    'destination' => '/space-a/settings/catalog/environments',
  ];

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
    // The add form display offers the workspace's projects as a picker.
    foreach (['core.entity_form_mode.bb_environment.add', 'core.entity_form_display.bb_environment.bb_environment.add'] as $name) {
      $data = Yaml::decode((string) file_get_contents(dirname(DRUPAL_ROOT) . '/config/sync/' . $name . '.yml'));
      $this->container->get('config.storage')->write($name, $data);
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
    self::assertSame('/_workspace/{bb_workspace}/settings/catalog/environments/add', $route->getPath());

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
  public function testAddSavesForProjectOfTheWorkspace(): void {
    $project = (string) $this->fixture('a', 'bb_project')->id();
    // The tab's Add action carries the tab as its destination.
    $state = $this->submitAdd('staging', $project, ['destination' => '/space-a/settings/catalog/environments']);

    self::assertSame([], array_map('strval', $state->getErrors()));
    $saved = $this->environments('staging');
    self::assertCount(1, $saved);
    $environment = reset($saved);
    self::assertInstanceOf(ContentEntityInterface::class, $environment);
    self::assertSame($project, (string) $environment->get('project_id')->target_id);
    // A programmed submission reports no redirect; read the one it set.
    $redirect = (new \ReflectionProperty(FormState::class, 'redirect'))->getValue($state);
    self::assertInstanceOf(Url::class, $redirect);
    self::assertSame('/space-a/settings/catalog/environments', $redirect->toString());
  }

  /**
   * A project of another workspace is refused; nothing is saved.
   */
  public function testAddRejectsProjectOfAnotherWorkspace(): void {
    // A lead of both workspaces may read and create there: only the form's
    // own workspace check refuses B's project on A's Catalog.
    $this->addMembership($this->fixture('b', 'bb_workspace'), $this->lead, ['lead']);
    $state = $this->submitAdd('foreign', (string) $this->fixture('b', 'bb_project')->id());

    self::assertSame(['project_id' => 'Pick a project of this workspace.'], array_map('strval', $state->getErrors()));
    self::assertSame([], $this->environments('foreign'));
  }

  /**
   * Opened as the dialog, the add form posts into it and offers Cancel.
   */
  public function testDialogPostsIntoTheDialogWithCancel(): void {
    $this->pushAddRequest(self::DIALOG_QUERY);
    $form = $this->container->get('form_builder')->getForm($this->addForm());

    self::assertStringContainsString('_wrapper_format=island_dialog', (string) ($form['#attributes']['data-hx-post'] ?? ''));
    $actions = $form[WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY] ?? [];
    self::assertArrayHasKey('cancel', $actions, 'The action row in the hull offers Cancel.');
    self::assertSame('/space-a/settings/catalog/environments', $actions['cancel']['#props']['href']);
  }

  /**
   * A dialog save lands back on the tab the dialog was opened over.
   */
  public function testDialogSaveReturnsToTheTab(): void {
    $state = $this->submitAdd('dialog', (string) $this->fixture('a', 'bb_project')->id(), self::DIALOG_QUERY);

    self::assertSame([], array_map('strval', $state->getErrors()));
    self::assertCount(1, $this->environments('dialog'));
    $response = $state->getResponse();
    self::assertNotNull($response, 'The dialog answers with a header, not a redirect.');
    self::assertStringContainsString('/space-a/settings/catalog/environments', (string) $response->headers->get('HX-Location'));
  }

  /**
   * The edit page saves by a native round trip, so its redirect is followed.
   */
  public function testEditPageIsNotBoosted(): void {
    $request = Request::create('/edit', 'GET');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $form_object = $this->container->get('entity_type.manager')->getFormObject('bb_environment', 'edit');
    $form_object->setEntity($this->fixture('a', 'bb_environment'));

    $form = $this->container->get('form_builder')->getForm($form_object);

    self::assertSame('false', $form['#attributes']['data-hx-boost'] ?? NULL);
    self::assertArrayHasKey('messages', $form, 'Errors and the saved message show on the page.');
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
   *
   * @param string $name
   *   The environment name.
   * @param string $project
   *   The project id.
   * @param array<string, string> $query
   *   The request query.
   */
  private function submitAdd(string $name, string $project, array $query = []): FormStateInterface {
    $this->pushAddRequest($query);
    $state = (new FormState())->setValues([
      'name' => [['value' => $name]],
      'project_id' => $project,
      'op' => 'Save',
    ]);
    $this->container->get('form_builder')->submitForm($this->addForm(), $state);
    return $state;
  }

  /**
   * Pushes a request on the add route of workspace A.
   *
   * @param array<string, string> $query
   *   The request query.
   */
  private function pushAddRequest(array $query = []): void {
    $route = $this->container->get('router.route_provider')->getRouteByName(self::ADD_ROUTE);
    $request = Request::create('/add', 'GET', $query);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add([
      RouteObjectInterface::ROUTE_NAME => self::ADD_ROUTE,
      RouteObjectInterface::ROUTE_OBJECT => $route,
      'bb_workspace' => $this->fixture('a', 'bb_workspace'),
      '_raw_variables' => new InputBag(['bb_workspace' => 'space-a']),
    ]);
    $this->container->get('request_stack')->push($request);
  }

  /**
   * The add form object for the current request.
   */
  private function addForm(): BbEnvironmentForm {
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_environment', 'add');
    self::assertInstanceOf(BbEnvironmentForm::class, $form);
    $form->setEntity($form->getEntityFromRouteMatch($this->container->get('current_route_match'), 'bb_environment'));
    return $form;
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
