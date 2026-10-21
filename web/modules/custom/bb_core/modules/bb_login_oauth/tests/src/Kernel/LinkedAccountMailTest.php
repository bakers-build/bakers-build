<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login_oauth\Kernel;

use Symfony\Component\HttpFoundation\ParameterBag;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\social_auth\Entity\SocialAuth;
use Drupal\user\Entity\User;
use Symfony\Component\HttpFoundation\Request;

/**
 * The mail address of a linked account is visible but not editable (D5).
 *
 * @group bb_login_oauth
 */
final class LinkedAccountMailTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * The modules under test.
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'file', 'image', 'bb_core', 'bb_login',
    'social_api', 'social_auth', 'social_auth_google', 'bb_login_oauth',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('social_auth');
    $this->installConfig(['user', 'social_auth']);
  }

  /**
   * A linked account cannot edit its mail address.
   */
  public function testLinkedAccountCannotEditMail(): void {
    $user = User::create(['name' => 'ada', 'mail' => 'ada@example.com', 'status' => 1]);
    $user->save();
    SocialAuth::create([
      'user_id' => $user->id(),
      'plugin_id' => 'social_auth_google',
      'provider_user_id' => 'google-1',
      'token' => 'token',
      'additional_data' => [],
    ])->save();

    self::assertFalse($user->get('mail')->access('edit', $user));
  }

  /**
   * An unlinked account can still edit its mail address.
   */
  public function testUnlinkedAccountCanEditMail(): void {
    $user = User::create(['name' => 'bob', 'mail' => 'bob@example.com', 'status' => 1]);
    $user->save();

    self::assertTrue($user->get('mail')->access('edit', $user));
  }

  /**
   * A linked account's mail address remains viewable (D5).
   */
  public function testLinkedAccountCanStillViewMail(): void {
    $user = User::create(['name' => 'carol', 'mail' => 'carol@example.com', 'status' => 1]);
    $user->save();
    SocialAuth::create([
      'user_id' => $user->id(),
      'plugin_id' => 'social_auth_google',
      'provider_user_id' => 'google-2',
      'token' => 'token',
      'additional_data' => [],
    ])->save();

    self::assertTrue($user->get('mail')->access('view', $user));
  }

  /**
   * The built user form disables the mail field for a linked account.
   */
  public function testUserFormDisablesMailForLinkedAccount(): void {
    $user = User::create(['name' => 'dave', 'mail' => 'dave@example.com', 'status' => 1]);
    $user->save();
    SocialAuth::create([
      'user_id' => $user->id(),
      'plugin_id' => 'social_auth_google',
      'provider_user_id' => 'google-3',
      'token' => 'token',
      'additional_data' => [],
    ])->save();

    $this->setCurrentUser($user);
    $provider = $this->container->get('router.route_provider');
    $route = $provider->getRouteByName('entity.user.edit_form');
    $request = Request::create(str_replace('{user}', (string) $user->id(), $route->getPath()));
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, 'entity.user.edit_form');
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('user', $user);
    $request->attributes->set('_raw_variables', new ParameterBag([
      'user' => (string) $user->id(),
    ]));
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $this->container->get('request_stack')->push($request);

    /** @var \Drupal\Core\Entity\EntityFormBuilderInterface $form_builder */
    $form_builder = $this->container->get('entity.form_builder');
    $form = $form_builder->getForm($user, 'default');

    // #access must be forced back to TRUE: AccountForm's own default is
    // `$account->mail->access('edit')`, which the field-access hook above
    // answers FALSE — without the override the field would be REMOVED from
    // the form, not merely disabled, breaking D5 ("visible, but read-only").
    self::assertTrue($form['account']['mail']['#access']);
    self::assertTrue($form['account']['mail']['#disabled']);
    self::assertStringContainsString('google', (string) $form['account']['mail']['#description']);
  }

}
