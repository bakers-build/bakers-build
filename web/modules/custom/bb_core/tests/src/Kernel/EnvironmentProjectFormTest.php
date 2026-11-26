<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

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
 * Adding and deleting an environment from its project's Environments tab.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class EnvironmentProjectFormTest extends KernelTestBase {

  use UserCreationTrait;
  use WorkspaceReadScopeTestTrait;

  private const ADD_ROUTE = 'entity.bb_environment.add_for_project';

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
   * The Environments tab of project A, the dialog's return address.
   */
  private string $tab;

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
    $this->tab = '/space-a/project/' . $this->fixture('a', 'bb_project')->id() . '/environments';
  }

  /**
   * The add route sits on the project and needs the create right there.
   */
  public function testAddNeedsTheCreateRight(): void {
    $contributor = $this->createAccount('north-contributor');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $contributor, ['contributor']);
    $south = $this->member('b');
    $this->addMembership($this->fixture('b', 'bb_workspace'), $south, ['lead']);
    $parameters = ['bb_workspace' => 'space-a', 'bb_project' => $this->fixture('a', 'bb_project')->id()];
    $url = Url::fromRoute(self::ADD_ROUTE, $parameters);

    self::assertTrue($url->access($this->lead));
    self::assertFalse($url->access($contributor), 'A contributor only reads environments.');
    self::assertFalse($url->access($south), 'Nor a lead of another workspace.');
  }

  /**
   * The project comes from the route; its selector is hidden.
   */
  public function testAddTakesTheRouteProject(): void {
    $this->pushAddRequest();
    $form = $this->container->get('form_builder')->getForm($this->addForm());
    self::assertFalse($form['project_id']['#access'] ?? TRUE, 'The project selector is hidden.');

    $state = $this->submitAdd('staging', ['destination' => $this->tab]);

    self::assertSame([], array_map('strval', $state->getErrors()));
    $saved = $this->environments('staging');
    self::assertCount(1, $saved);
    $environment = reset($saved);
    self::assertInstanceOf(ContentEntityInterface::class, $environment);
    self::assertSame((string) $this->fixture('a', 'bb_project')->id(), (string) $environment->get('project_id')->target_id);
    $redirect = (new \ReflectionProperty(FormState::class, 'redirect'))->getValue($state);
    self::assertInstanceOf(Url::class, $redirect);
    self::assertSame($this->tab, $redirect->toString());
  }

  /**
   * As the dialog, the add form offers Cancel and its save returns to the tab.
   */
  public function testDialogReturnsToTheTab(): void {
    $query = ['_wrapper_format' => 'island_dialog', 'destination' => $this->tab];
    $this->pushAddRequest($query);
    $form = $this->container->get('form_builder')->getForm($this->addForm());
    $actions = $form[WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY] ?? [];
    self::assertSame($this->tab, $actions['cancel']['#props']['href'] ?? NULL);

    $state = $this->submitAdd('dialog', $query);

    self::assertSame([], array_map('strval', $state->getErrors()));
    self::assertCount(1, $this->environments('dialog'));
    $response = $state->getResponse();
    self::assertNotNull($response, 'The dialog answers with a header, not a redirect.');
    self::assertStringContainsString($this->tab, (string) $response->headers->get('HX-Location'));
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
   * Deleting an environment returns to its project's Environments tab.
   */
  public function testDeleteReturnsToTheProjectTab(): void {
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_environment', 'delete');
    self::assertInstanceOf(BbContentEntityDeleteForm::class, $form);
    $form->setEntity($this->fixture('a', 'bb_environment'));

    $url = (new \ReflectionMethod($form, 'getRedirectUrl'))->invoke($form);

    self::assertSame('view.bb_environments.project_list', $url->getRouteName());
    self::assertSame($this->fixture('a', 'bb_project')->toUrl()->getRouteParameters()['bb_project'], $url->getRouteParameters()['bb_project']);
  }

  /**
   * Submits the add form of project A.
   *
   * @param string $name
   *   The environment name.
   * @param array<string, string> $query
   *   The request query.
   */
  private function submitAdd(string $name, array $query = []): FormStateInterface {
    $this->pushAddRequest($query);
    $state = (new FormState())->setValues(['name' => [['value' => $name]], 'op' => 'Save']);
    $this->container->get('form_builder')->submitForm($this->addForm(), $state);
    return $state;
  }

  /**
   * Pushes a request on the add route of project A.
   *
   * @param array<string, string> $query
   *   The request query.
   */
  private function pushAddRequest(array $query = []): void {
    $route = $this->container->get('router.route_provider')->getRouteByName(self::ADD_ROUTE);
    $project = $this->fixture('a', 'bb_project');
    $request = Request::create('/add', 'GET', $query);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add([
      RouteObjectInterface::ROUTE_NAME => self::ADD_ROUTE,
      RouteObjectInterface::ROUTE_OBJECT => $route,
      'bb_workspace' => $this->fixture('a', 'bb_workspace'),
      'bb_project' => $project,
      '_raw_variables' => new InputBag(['bb_workspace' => 'space-a', 'bb_project' => (string) $project->id()]),
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
