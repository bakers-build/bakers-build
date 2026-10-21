<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Drupal\og\Entity\OgRole;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\EnforcedResponseException;
use Drupal\Component\Utility\Crypt;
use Drupal\Core\Render\Element;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Form\BbCreateDialogFormBase;
use Drupal\bb_core\Access\BbWorkspaceCreateAccess;
use Drupal\Core\Session\AccountInterface;
use Drupal\island\DefaultAppProvider;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;
use Drupal\island\IslandProfileHost;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Group and team creation protect application context in one routed form.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class GroupTeamCreateFormTest extends KernelTestBase {

  use UserCreationTrait;
  use ShippedImageConfigTrait;
  use OgScopeFixtureTrait;
  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'crop', 'bb_image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'island', 'views', 'better_exposed_filters',
    'ui_patterns', 'ui_patterns_views', 'display_builder',
    'display_builder_views', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_term', 'bb_environment',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'filter', 'views', 'bb_core']);
    $this->installShippedFormDisplays();
    $this->installShippedView('views.view.projects');
    $this->installShippedView('views.view.groups');
    $this->container->get('router.builder')->rebuild();
    $this->createUser([], 'uid1-dummy');
    $account = $this->createUser(['administer bakers', 'create bb_group', 'create bb_team'], 'creator');
    self::assertNotFalse($account);
    $this->setCurrentUser($account);
  }

  /**
   * Both public create routes resolve the same existing dialog infrastructure.
   */
  public function testBothRoutesUseOneSharedCreateForm(): void {
    $manager = $this->container->get('entity_type.manager');
    $provider = $this->container->get('router.route_provider');
    $handlers = [];
    foreach (['bb_group', 'bb_team'] as $type) {
      $route = $provider->getRouteByName('entity.' . $type . '.create_form');
      self::assertSame($type . '.create', $route->getDefault('_entity_form'));
      self::assertSame($type, $route->getRequirement('_entity_create_access'));
      $handler = $manager->getDefinition($type)->getFormClass('create');
      self::assertTrue(is_subclass_of($handler, BbCreateDialogFormBase::class));
      $handlers[] = $handler;
    }
    self::assertSame($handlers[0], $handlers[1]);
  }

  /**
   * Only the identity fields are editable, even for an administrator.
   *
   * A group offers Name, Description and Image; a team, sharing the form
   * class, still offers Name alone. Context is server-bound.
   */
  public function testNameOnlyFormBindsWorkspaceAndOwner(): void {
    $manager = $this->container->get('entity_type.manager');
    $workspace = $manager->getStorage('bb_workspace')->create(['name' => 'Workspace A', 'slug' => 'workspace-a']);
    $workspace->save();
    foreach (['bb_group' => ['name', 'description', 'image'], 'bb_team' => ['name']] as $type => $editable) {
      $route_name = 'entity.' . $type . '.create_form';
      $request = Request::create('/_workspace/workspace-a/' . substr($type, 5) . '/create');
      $request->setSession(new Session(new MockArraySessionStorage()));
      $request->attributes->add([
        '_route' => $route_name,
        '_route_object' => $this->container->get('router.route_provider')->getRouteByName($route_name),
        'bb_workspace' => $workspace,
      ]);
      $this->container->get('request_stack')->push($request);
      self::assertSame($workspace, $this->container->get('bb_core.active_workspace')->resolve());
      $form_object = $manager->getFormObject($type, 'create');
      $form_object->setEntity($manager->getStorage($type)->create());
      $state = new FormState();
      $form = $this->container->get('form_builder')->buildForm($form_object, $state);
      $entity = $form_object->getEntity();
      self::assertInstanceOf(ContentEntityInterface::class, $entity);
      self::assertSame($editable, array_values(array_intersect(Element::children($form, TRUE), array_keys($entity->getFieldDefinitions()))));
      self::assertSame((string) $workspace->id(), (string) $entity->get('workspace_id')->target_id);
      self::assertSame((string) $this->container->get('current_user')->id(), (string) $entity->get('owner_user_id')->target_id);
      self::assertSame('bb_create_dialog', $form['#theme']);
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * A submission saves exactly one subject using trusted context.
   */
  public function testCreateSavesOneSubjectAndRefreshesItsList(): void {
    $manager = $this->container->get('entity_type.manager');
    foreach (['bb_group', 'bb_team'] as $type) {
      $state = $this->postSubject($type, [
        'name' => [['value' => 'New crew']],
        'workspace_id' => [['target_id' => 9999]],
        'owner_user_id' => [['target_id' => 1]],
      ]);
      self::assertSame([], $state->getErrors());
      $rows = $manager->getStorage($type)->loadMultiple();
      self::assertCount(1, $rows);
      $entity = reset($rows);
      self::assertInstanceOf(ContentEntityInterface::class, $entity);
      self::assertSame('New crew', $entity->label());
      self::assertSame((string) $this->container->get('current_user')->id(), (string) $entity->get('owner_user_id')->target_id);
      self::assertSame('Workspace A', $entity->get('workspace_id')->entity->label());
      self::assertNotNull($state->getResponse());
      self::assertNull($state->getResponse()->headers->get('HX-Redirect'));
      if ($type === 'bb_team') {
        self::assertSame('delete', $state->getResponse()->headers->get('HX-Reswap'));
      }
      else {
        self::assertSame('/workspace-a/projects', $state->getResponse()->headers->get('HX-Location'));
        self::assertSame('', $state->getResponse()->getContent());
      }
    }
  }

  /**
   * Invalid names are rejected without writing or losing the input.
   */
  public function testInvalidNamesAreRejected(): void {
    foreach (['bb_group', 'bb_team'] as $type) {
      foreach ([
        '' => 'Enter a name.',
        '   ' => 'Enter a name.',
        str_repeat('a', 256) => 'Name cannot be longer than 255 characters but is currently 256 characters long.',
      ] as $name => $message) {
        $state = $this->postSubject($type, ['name' => [['value' => $name]]]);
        self::assertContains($message, array_map(static fn ($error) => strip_tags((string) $error), $state->getErrors()));
        self::assertSame($name, $state->getValue(['name', 0, 'value']));
        self::assertCount(0, $this->container->get('entity_type.manager')->getStorage($type)->loadMultiple());
      }
    }
  }

  /**
   * The boundary length is accepted in full, and another creation still works.
   */
  public function testBoundaryNameAndRepeatedCreation(): void {
    foreach (['bb_group', 'bb_team'] as $type) {
      foreach ([str_repeat('ä', 255), 'Second crew'] as $name) {
        $state = $this->postSubject($type, ['name' => [['value' => $name]]]);
        self::assertSame([], $state->getErrors());
        self::assertCount(1, $this->container->get('entity_type.manager')->getStorage($type)->loadByProperties(['name' => $name]));
      }
      self::assertCount(2, $this->container->get('entity_type.manager')->getStorage($type)->loadMultiple());
    }
  }

  /**
   * A lead rank in another workspace must not authorize these create routes.
   */
  public function testForeignRankCannotCreateInWorkspaceA(): void {
    $this->installConfig(['og']);
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    $this->registerShippedOgGroups();
    $manager = $this->container->get('entity_type.manager');
    $workspace = $manager->getStorage('bb_workspace')->create(['name' => 'Workspace B', 'slug' => 'workspace-b']);
    $workspace->save();
    $account = $this->createUser([], 'foreign-lead');
    self::assertNotFalse($account);
    $membership = $this->container->get('og.membership_manager')->createMembership($workspace, $account);
    $membership->addRole(OgRole::load('bb_workspace-bb_workspace-lead'));
    $membership->save();
    $this->setCurrentUser($account);
    foreach (['bb_group', 'bb_team'] as $type) {
      self::assertTrue($account->hasPermission('create ' . $type));
      try {
        $this->postSubject($type, ['name' => [['value' => 'Forbidden crew']]]);
        self::fail('A foreign rank must be refused before building or submitting.');
      }
      catch (AccessDeniedHttpException) {
        self::assertCount(0, $manager->getStorage($type)->loadMultiple());
      }
    }
  }

  /**
   * A site-wide create grant still has to satisfy the hidden scope constraint.
   */
  public function testHiddenWorkspaceConstraintIsNotFilteredOut(): void {
    $account = $this->createUser(['create bb_group', 'create bb_team'], 'creator-without-membership');
    self::assertNotFalse($account);
    $this->setCurrentUser($account);
    foreach (['bb_group', 'bb_team'] as $type) {
      $state = $this->postSubject($type, ['name' => [['value' => 'No membership']]]);
      self::assertNotEmpty($state->getErrors());
      self::assertStringContainsString('Workspace A', implode(' ', array_map(static fn ($error) => strip_tags((string) $error), $state->getErrors())));
      self::assertCount(0, $this->container->get('entity_type.manager')->getStorage($type)->loadMultiple());
    }
  }

  /**
   * A form instantiated outside a workspace route must fail closed.
   */
  public function testMissingWorkspaceCannotBuildOrSave(): void {
    $manager = $this->container->get('entity_type.manager');
    foreach (['bb_group', 'bb_team'] as $type) {
      $form = $manager->getFormObject($type, 'create');
      $form->setEntity($manager->getStorage($type)->create(['name' => 'Missing context']));
      foreach (['buildForm', 'validateForm', 'submitForm', 'save'] as $method) {
        try {
          $build = [];
          $form->$method($build, new FormState());
          self::fail('Missing workspace context must be refused in ' . $method);
        }
        catch (AccessDeniedHttpException) {
          self::assertCount(0, $manager->getStorage($type)->loadMultiple());
        }
      }
    }
  }

  /**
   * A supplied destination cannot move a successful create into another tenant.
   */
  public function testReturnDestinationStaysInTheRoutedWorkspace(): void {
    foreach (['https://example.com/', '//example.com/', '/workspace-b/projects', '/'] as $destination) {
      $state = $this->postSubject('bb_group', ['name' => [['value' => 'Safe return']]], $destination);
      self::assertNull($state->getResponse()?->headers->get('HX-Redirect'));
      self::assertSame('/workspace-a/groups', $state->getResponse()?->headers->get('HX-Location'));
    }
  }

  /**
   * The configured superuser policy survives scoping, including its opt-out.
   */
  public function testConfiguredSuperuserGrantIsPreserved(): void {
    $manager = $this->container->get('entity_type.manager');
    $root = $manager->getStorage('user')->load(1);
    self::assertInstanceOf(AccountInterface::class, $root);
    $workspace = $manager->getStorage('bb_workspace')->create(['name' => 'A', 'slug' => 'a']);
    $workspace->save();
    foreach (['bb_group', 'bb_team'] as $type) {
      foreach ([TRUE, FALSE] as $enabled) {
        $access = new BbWorkspaceCreateAccess($manager, $this->container->get('bb_core.rank_capability'), $enabled);
        self::assertSame($enabled, $access->check($type, $workspace, $root)->isAllowed());
      }
    }
  }

  /**
   * Sends the ordinary entity form submit chain through a real POST request.
   *
   * @param string $type
   *   The trusted routed entity type.
   * @param array<string, mixed> $values
   *   Submitted form values.
   * @param string $destination
   *   The requested return destination.
   */
  private function postSubject(string $type, array $values, string $destination = '/workspace-a/projects'): FormStateInterface {
    $manager = $this->container->get('entity_type.manager');
    $workspaces = $manager->getStorage('bb_workspace')->loadByProperties(['slug' => 'workspace-a']);
    $workspace = reset($workspaces);
    if (!$workspace) {
      $workspace = $manager->getStorage('bb_workspace')->create([
        'name' => 'Workspace A',
        'slug' => 'workspace-a',
        'owner_user_id' => 1,
      ]);
      $workspace->save();
    }
    $route_name = 'entity.' . $type . '.create_form';
    $form = $manager->getFormObject($type, 'create');
    $form->setEntity($manager->getStorage($type)->create());
    $form_id = $form->getFormId();
    $request = Request::create('/workspace-a/' . substr($type, 5) . '/create?destination=' . urlencode($destination) . '&_wrapper_format=island_dialog', 'POST', $values + [
      'form_id' => $form_id,
      // Named explicitly: the group form's image widget adds an Upload button
      // earlier in the form, which would otherwise be the triggering element.
      'op' => $type === 'bb_group' ? 'Create group' : 'Create team',
    ]);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add([
      '_route' => $route_name,
      '_route_object' => $this->container->get('router.route_provider')->getRouteByName($route_name),
      'bb_workspace' => $workspace,
    ]);
    $request->request->set('form_token', $this->container->get('csrf_token')->get('form_token_placeholder_' . Crypt::hashBase64($form_id)));
    // These form tests isolate writes from presentation. The browser suite
    // exercises the real profile subscriptions and fragment replacements.
    $request->attributes->set('_island_profile_host', new IslandProfileHost(
      App::create(['id' => 'creation']),
      IslandProfile::create(['id' => 'creation', 'app' => 'creation', 'placements' => []]),
      new DefaultAppProvider(),
      'page',
      $this->container->get('island.condition_evaluator'),
    ));
    $this->container->get('request_stack')->push($request);
    $state = new FormState();
    try {
      $this->container->get('form_builder')->buildForm($form, $state);
    }
    catch (EnforcedResponseException $exception) {
      $state->setResponse($exception->getResponse());
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
    return $state;
  }

}
