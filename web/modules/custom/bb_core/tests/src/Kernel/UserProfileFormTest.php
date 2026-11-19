<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\Core\StringTranslation\Translator\StaticTranslation;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\bb_core\Controller\UserProfileController;
use Drupal\bb_core\Entity\BbProfileInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Profile\Profiles;
use Drupal\user\UserInterface;
use Drupal\views\Entity\View;
use Symfony\Component\Yaml\Yaml;
use Symfony\Component\HttpFoundation\InputBag;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Route;

/**
 * The Profile page edits a user's position and background.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class UserProfileFormTest extends KernelTestBase {

  use UserCreationTrait;
  use UserProfileTestTrait;
  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'ui_patterns', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_group', 'bb_project'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    // UID 1 dummy so no test account is the superuser.
    $this->createUser([], 'uid1-dummy');
    $this->installUserProfileConfig();
  }

  /**
   * Creates a user without extra permissions.
   */
  private function person(): UserInterface {
    $user = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $user);
    return $user;
  }

  /**
   * Creates a workspace.
   */
  private function workspace(string $name): BbWorkspaceInterface {
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => $name, 'slug' => strtolower($name)]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    return $workspace;
  }

  /**
   * A user saves their own position and background in one workspace only.
   */
  public function testOwnProfileSavesPerWorkspaceAndClears(): void {
    $user = $this->person();
    $north = (int) $this->workspace('North')->id();
    $south = (int) $this->workspace('South')->id();
    $this->setCurrentUser($user);

    $formState = $this->submitUserProfile($user, $north, 'Product Lead', 'Drupal and product work');
    self::assertSame([], $formState->getErrors());
    self::assertSame(['Product Lead', 'Drupal and product work'], $this->storedUserProfile($user, $north));
    self::assertSame(['', ''], $this->storedUserProfile($user, $south), 'the other workspace is untouched');

    $formState = $this->submitUserProfile($user, $north, '', '');
    self::assertSame([], $formState->getErrors());
    self::assertSame(['', ''], $this->storedUserProfile($user, $north));
  }

  /**
   * The form holds position and background, not owner, workspace, favorites.
   */
  public function testFormHoldsOnlyTheProfileFields(): void {
    $user = $this->person();
    $this->setCurrentUser($user);
    $profile = $this->container->get(Profiles::class)->forAccount((int) $user->id(), (int) $this->workspace('North')->id());
    $form = $this->container->get('entity.form_builder')->getForm($profile, 'default');

    self::assertArrayHasKey('position', $form);
    self::assertArrayHasKey('background', $form);
    foreach (['uid', 'workspace_id', 'favorite_projects', 'created'] as $key) {
      self::assertFalse(isset($form[$key]) && ($form[$key]['#access'] ?? TRUE) !== FALSE, "no $key element");
    }
  }

  /**
   * The account fields are gone from both config homes.
   */
  public function testAccountFieldsAreGone(): void {
    foreach (['config/sync', 'recipes/bakers/config'] as $home) {
      $storage = new FileStorage(dirname($this->root) . '/' . $home);
      foreach (['field_developer_title', 'field_bb_background'] as $field) {
        self::assertFalse($storage->exists("field.storage.user.$field"), "$home: $field");
      }
    }
  }

  /**
   * The page edits the workspace in context, else the first; none: empty state.
   */
  public function testPageEditsTheWorkspaceInContext(): void {
    $user = $this->person();
    $south = $this->workspace('South');
    $north = $this->workspace('North');
    $this->addMembership($south, $user, ['member']);
    $this->addMembership($north, $user, ['member']);
    $this->installMyWorkRoute();
    $this->setCurrentUser($user);

    $this->openProfile($user);
    self::assertSame((int) $north->id(), $this->pageProfile($user)->workspaceId(), 'first by label');
    $this->openProfile($user, $south->uuid());
    self::assertSame((int) $south->id(), $this->pageProfile($user)->workspaceId(), 'the origin');
    self::assertSame('Profile in South', (string) $this->controller()->title($user));

    $homeless = $this->person();
    $this->setCurrentUser($homeless);
    $this->openProfile($homeless);
    self::assertSame(0, $this->pageProfile($homeless)->workspaceId(), 'no workspace');
    $form = $this->container->get('entity.form_builder')->getForm($this->pageProfile($homeless), 'default');
    self::assertArrayNotHasKey('position', $form, 'an empty state, no fields');
    self::assertArrayNotHasKey('actions', $form, 'nothing to save');
  }

  /**
   * Registers the My work page, which the workspace origin must reach.
   */
  private function installMyWorkRoute(): void {
    $this->enableModules(['views']);
    $shipped = Yaml::parseFile(dirname(DRUPAL_ROOT) . '/recipes/bakers/config/views.view.tickets.yml');
    View::create([
      'id' => 'tickets',
      'label' => 'tickets',
      'base_table' => 'users_field_data',
      'base_field' => 'uid',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_title' => 'Default',
          'display_plugin' => 'default',
          'position' => 0,
          'display_options' => ['access' => ['type' => 'none']],
        ],
        'my_work' => [
          'id' => 'my_work',
          'display_title' => 'My work',
          'display_plugin' => 'page',
          'position' => 1,
          'display_options' => ['path' => $shipped['display']['my_work']['display_options']['path']],
        ],
      ],
    ])->save();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Pushes a request for a user's Profile page.
   */
  private function openProfile(UserInterface $user, ?string $workspace = NULL): void {
    $request = Request::create('/user/' . $user->id() . '/profile', 'GET', $workspace === NULL ? [] : ['workspace' => $workspace]);
    $request->setSession($this->container->get('request_stack')->getSession());
    $route = $this->container->get('router.route_provider')->getRouteByName('bb_core.user.profile');
    $request->attributes->add([
      RouteObjectInterface::ROUTE_NAME => 'bb_core.user.profile',
      RouteObjectInterface::ROUTE_OBJECT => $route,
      'user' => $user,
      '_raw_variables' => new InputBag(['user' => $user->id()]),
    ]);
    $this->container->get('request_stack')->push($request);
    $this->container->get('current_route_match')->resetRouteMatch();
  }

  /**
   * The profile the page's entity form edits for the pushed request.
   */
  private function pageProfile(UserInterface $user): BbProfileInterface {
    $form = $this->container->get('entity_type.manager')->getFormObject('bb_profile', 'default');
    $profile = $form->getEntityFromRouteMatch($this->container->get('current_route_match'), 'bb_profile');
    self::assertInstanceOf(BbProfileInterface::class, $profile);
    self::assertSame((int) $user->id(), $profile->getOwnerId());
    return $profile;
  }

  /**
   * The Profile page controller.
   */
  private function controller(): UserProfileController {
    return $this->container->get('class_resolver')->getInstanceFromDefinition(UserProfileController::class);
  }

  /**
   * Only the own account or `administer users` may edit a human's profile.
   */
  public function testEditProfileAccess(): void {
    $own = $this->person();
    $other = $this->person();
    $admin = $this->createUser(['administer users']);
    self::assertInstanceOf(UserInterface::class, $admin);

    self::assertTrue($own->access('edit profile', $own), 'the own account');
    self::assertFalse($own->access('edit profile', $other), 'another human without administer users');
    self::assertFalse($own->access('update', $other), 'edit profile grants no update');
    self::assertTrue($own->access('edit profile', $admin), 'administer users');
  }

  /**
   * The route takes cookie sessions only; the field reads Position.
   */
  public function testRouteIsCookieOnlyAndFieldIsPosition(): void {
    $route = $this->container->get('router.route_provider')->getRouteByName('bb_core.user.profile');
    self::assertSame('/user/{user}/profile', $route->getPath());
    self::assertSame(['cookie'], $route->getOption('_auth'));
    self::assertSame('user.edit profile', $route->getRequirement('_entity_access'));
    self::assertSame('bb_profile.default', $route->getDefault('_entity_form'), 'the form token guards the POST');
    self::assertSame('entity:user', $route->getOption('parameters')['user']['type'] ?? NULL);
    self::assertTrue($route->getOption('_bb_user_area'), 'the profile page sits in the account area');

    $label = $this->container->get('entity_field.manager')->getFieldDefinitions('bb_profile', 'bb_profile')['position']->getLabel();
    self::assertSame('Position', (string) $label);
  }

  /**
   * The Profile page's AI-use notice goes through string translation.
   */
  public function testProfileDescriptionIsTranslatable(): void {
    $notice = 'bakers.build passes these details as context to the AI assistants it uses, so that explanations and support match your background and your goals. You can change or delete them later.';
    $this->container->get('string_translation')->addTranslator(new StaticTranslation([
      'en' => ['' => [$notice => 'Übersetzter Hinweis']],
    ]));
    $request = Request::create('/user/2/profile');
    $request->setSession($this->container->get('request_stack')->getSession());
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, 'bb_core.user.profile');
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, new Route('/user/{user}/profile'));
    $this->container->get('request_stack')->push($request);
    $this->container->get('current_route_match')->resetRouteMatch();

    $source = $this->container->get('plugin.manager.ui_patterns_source')->createInstance('bb_page_header_description', []);
    self::assertInstanceOf(SourcePluginBase::class, $source);
    self::assertSame('Übersetzter Hinweis', (string) $source->getPropValue());
  }

}
