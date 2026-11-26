<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityFormInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\BbContentEntityFormBase;
use Drupal\island\Render\WrappedRouteRenderer;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\InputBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Terms and environments use the plain entity form and its form display.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CatalogEntityFormTest extends KernelTestBase {

  use UserCreationTrait;
  use WorkspaceReadScopeTestTrait;

  /**
   * The shipped form displays these forms are built from.
   */
  private const FORM_DISPLAYS = [
    'core.entity_form_display.bb_term.type.default',
    'core.entity_form_display.bb_term.recipe.default',
    'core.entity_form_display.bb_term.label.default',
    'core.entity_form_mode.bb_environment.add',
    'core.entity_form_display.bb_environment.bb_environment.default',
    'core.entity_form_display.bb_environment.bb_environment.add',
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
    $storage = $this->container->get('config.storage');
    foreach (self::FORM_DISPLAYS as $name) {
      $data = Yaml::decode((string) file_get_contents(dirname(DRUPAL_ROOT) . '/config/sync/' . $name . '.yml'));
      unset($data['_core']);
      $storage->write($name, $data);
    }
    $this->container->get('router.builder')->rebuild();

    $this->lead = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->lead, ['lead']);
    $this->setCurrentUser($this->lead);
  }

  /**
   * A term is added and edited by the plain entity form.
   */
  public function testTermFormIsThePlainEntityForm(): void {
    $manager = $this->container->get('entity_type.manager');
    foreach (['add', 'edit'] as $operation) {
      self::assertSame(BbContentEntityFormBase::class, get_class($manager->getFormObject('bb_term', $operation)));
    }
  }

  /**
   * A new term takes the route's workspace.
   */
  public function testTermAddTakesTheRouteWorkspace(): void {
    $state = $this->submitTermAdd('space-a', 'urgent');

    self::assertSame([], array_map('strval', $state->getErrors()));
    $saved = $this->entities('bb_term', 'urgent');
    self::assertCount(1, $saved);
    $term = reset($saved);
    self::assertInstanceOf(ContentEntityInterface::class, $term);
    self::assertSame((string) $this->fixture('a', 'bb_workspace')->id(), (string) $term->get('workspace_id')->target_id);
  }

  /**
   * A term on a workspace the account may not write in is refused.
   */
  public function testTermAddInForeignWorkspaceIsRefused(): void {
    $state = $this->submitTermAdd('space-b', 'foreign');

    self::assertNotSame([], $state->getErrors());
    self::assertSame([], $this->entities('bb_term', 'foreign'));
  }

  /**
   * The term form shows name and description, not the owner.
   */
  public function testTermFormHidesTheOwner(): void {
    $form = $this->buildEdit('bb_term', $this->fixture('a', 'bb_term'));

    self::assertArrayHasKey('name', $form);
    self::assertArrayHasKey('description', $form);
    self::assertArrayNotHasKey('owner_user_id', $form);
  }

  /**
   * The environment form shows only editable fields, in no meta group.
   */
  public function testEnvironmentFormShowsOnlyEditableFields(): void {
    $form = $this->buildEdit('bb_environment', $this->fixture('a', 'bb_environment'));

    foreach (['name', 'project_id', 'base_url', 'tier', 'branch'] as $field) {
      self::assertArrayHasKey($field, $form);
    }
    foreach (['created', 'changed', 'owner_user_id', 'meta'] as $hidden) {
      self::assertArrayNotHasKey($hidden, $form);
    }
  }

  /**
   * Saving an existing term or environment stays on its edit form.
   */
  public function testSaveStaysOnTheEditForm(): void {
    foreach (['bb_term', 'bb_environment'] as $type) {
      $entity = $this->fixture('a', $type);
      $redirect = $this->redirectOf($this->submitEdit($type, $entity));
      self::assertInstanceOf(Url::class, $redirect, $type);
      self::assertSame("entity.$type.edit_form", $redirect->getRouteName());
    }
  }

  /**
   * Given a destination, a save lands there.
   */
  public function testSaveFollowsTheDestination(): void {
    $state = $this->submitEdit('bb_term', $this->fixture('a', 'bb_term'), ['destination' => '/space-a/settings/catalog/labels']);

    $redirect = $this->redirectOf($state);
    self::assertInstanceOf(Url::class, $redirect);
    self::assertSame('/space-a/settings/catalog/labels', $redirect->toString());
  }

  /**
   * As the dialog, the term add posts into it, offers Cancel and returns.
   */
  public function testTermDialogOffersCancelAndReturnsToTheTab(): void {
    $query = ['_wrapper_format' => 'island_dialog', 'destination' => '/space-a/settings/catalog/labels'];
    $this->pushTermAddRequest('space-a', $query);
    $form = $this->container->get('form_builder')->getForm($this->termAddForm());
    self::assertStringContainsString('_wrapper_format=island_dialog', (string) ($form['#attributes']['data-hx-post'] ?? ''));
    $actions = $form[WrappedRouteRenderer::ACTIONS_SLOT_PROPERTY] ?? [];
    self::assertSame('/space-a/settings/catalog/labels', $actions['cancel']['#props']['href'] ?? NULL);

    $state = $this->submitTermAdd('space-a', 'dialog', $query);

    self::assertCount(1, $this->entities('bb_term', 'dialog'));
    $response = $state->getResponse();
    self::assertNotNull($response, 'The dialog answers with a header, not a redirect.');
    self::assertStringContainsString('/space-a/settings/catalog/labels', (string) $response->headers->get('HX-Location'));
  }

  /**
   * Builds the edit form of an entity.
   *
   * @return array<string, mixed>
   *   The built form.
   */
  private function buildEdit(string $type, ContentEntityInterface $entity): array {
    $this->pushRequest('/edit', []);
    return $this->container->get('form_builder')->getForm($this->formObject($type, 'edit', $entity));
  }

  /**
   * Submits the edit form of an entity unchanged.
   *
   * @param string $type
   *   The entity type.
   * @param \Drupal\Core\Entity\ContentEntityInterface $entity
   *   The entity.
   * @param array<string, string> $query
   *   The request query.
   */
  private function submitEdit(string $type, ContentEntityInterface $entity, array $query = []): FormStateInterface {
    $this->pushRequest('/edit', $query);
    $state = (new FormState())->setValues(['name' => [['value' => $entity->label() . ' renamed']], 'op' => 'Save']);
    $this->container->get('form_builder')->submitForm($this->formObject($type, 'edit', $entity), $state);
    self::assertSame([], array_map('strval', $state->getErrors()));
    return $state;
  }

  /**
   * Submits the label add form on the given workspace.
   *
   * @param string $slug
   *   The workspace slug.
   * @param string $name
   *   The term name.
   * @param array<string, string> $query
   *   The request query.
   */
  private function submitTermAdd(string $slug, string $name, array $query = []): FormStateInterface {
    $this->pushTermAddRequest($slug, $query);
    $state = (new FormState())->setValues(['name' => [['value' => $name]], 'op' => 'Save']);
    $this->container->get('form_builder')->submitForm($this->termAddForm(), $state);
    return $state;
  }

  /**
   * Pushes a request on the label add route of a workspace.
   *
   * @param string $slug
   *   The workspace slug.
   * @param array<string, string> $query
   *   The request query.
   */
  private function pushTermAddRequest(string $slug, array $query): void {
    $name = 'entity.bb_term.add_form';
    $workspace = $this->fixture($slug === 'space-a' ? 'a' : 'b', 'bb_workspace');
    $vocabulary = $this->container->get('entity_type.manager')->getStorage('bb_vocabulary')->load('label');
    $request = $this->pushRequest('/add', $query);
    $request->attributes->add([
      RouteObjectInterface::ROUTE_NAME => $name,
      RouteObjectInterface::ROUTE_OBJECT => $this->container->get('router.route_provider')->getRouteByName($name),
      'bb_workspace' => $workspace,
      'bb_vocabulary' => $vocabulary,
      '_raw_variables' => new InputBag(['bb_workspace' => $slug, 'bb_vocabulary' => 'label']),
    ]);
  }

  /**
   * The label add form for the current request.
   */
  private function termAddForm(): EntityFormInterface {
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_term', 'add');
    $form->setEntity($form->getEntityFromRouteMatch($this->container->get('current_route_match'), 'bb_term'));
    return $form;
  }

  /**
   * An entity form object for an entity.
   */
  private function formObject(string $type, string $operation, ContentEntityInterface $entity): EntityFormInterface {
    $form = $this->container->get('entity_type.manager')->getFormObject($type, $operation);
    $form->setEntity($entity);
    return $form;
  }

  /**
   * Pushes a GET request with a session.
   *
   * @param string $path
   *   The path.
   * @param array<string, string> $query
   *   The request query.
   */
  private function pushRequest(string $path, array $query): Request {
    $request = Request::create($path, 'GET', $query);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    return $request;
  }

  /**
   * The redirect a programmed submission set, which it does not report.
   */
  private function redirectOf(FormStateInterface $state): mixed {
    return (new \ReflectionProperty(FormState::class, 'redirect'))->getValue($state);
  }

  /**
   * The entities of a type with the given name.
   *
   * @return array<int|string, \Drupal\Core\Entity\EntityInterface>
   *   The matching entities.
   */
  private function entities(string $type, string $name): array {
    return $this->container->get('entity_type.manager')->getStorage($type)->loadByProperties(['name' => $name]);
  }

}
