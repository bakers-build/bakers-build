<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\Core\StringTranslation\Translator\StaticTranslation;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
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
    $this->installEntitySchema('user');
    $this->installConfig(['user']);
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
   * A user saves their own position and background, then clears them.
   */
  public function testOwnProfileSavesAndClears(): void {
    $user = $this->person();
    $this->setCurrentUser($user);

    $formState = $this->submitUserProfile($user, 'Product Lead', 'Drupal and product work');
    self::assertSame([], $formState->getErrors());
    self::assertSame(['Product Lead', 'Drupal and product work'], $this->storedUserProfile($user));

    $formState = $this->submitUserProfile($user, '', '');
    self::assertSame([], $formState->getErrors());
    self::assertSame([NULL, NULL], $this->storedUserProfile($user));
  }

  /**
   * The form holds position and background, never name, mail or password.
   */
  public function testFormHoldsOnlyTheProfileFields(): void {
    $user = $this->person();
    $this->setCurrentUser($user);
    $form = $this->container->get('entity.form_builder')->getForm($user, 'profile');

    self::assertArrayHasKey('field_developer_title', $form);
    self::assertArrayHasKey('field_bb_background', $form);
    foreach (['mail', 'name', 'pass', 'current_pass', 'status', 'roles'] as $key) {
      self::assertArrayNotHasKey($key, $form['account'] ?? [], "no $key element");
    }
    self::assertArrayNotHasKey('preferred_langcode', $form['language'] ?? []);
  }

  /**
   * Position and background are edited on Profile only, not on Account › Edit.
   */
  public function testAccountEditFormNoLongerHoldsTheProfileFields(): void {
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    $display = $storage->read('core.entity_form_display.user.user.default');
    self::assertIsArray($display);
    foreach (['field_developer_title', 'field_bb_background'] as $field) {
      self::assertArrayNotHasKey($field, $display['content'], "$field leaves the edit form");
      self::assertTrue($display['hidden'][$field] ?? FALSE, "$field is hidden on the edit form");
    }
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
    self::assertTrue($route->getOption('_bb_user_area'), 'the profile page sits in the account area');

    $label = $this->container->get('entity_field.manager')->getFieldDefinitions('user', 'user')['field_developer_title']->getLabel();
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
