<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\bb_login\Controller\BbOneTimeLoginController;
use Drupal\bb_login\Form\BbLoginForm;
use Drupal\KernelTests\KernelTestBase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Opening the login form parks its destination, query string included.
 *
 * The Google button is a plain link, so the parked value is the only thing
 * that brings a visitor back to a deep link such as the device page.
 *
 * @group bb_login
 */
final class LoginDestinationParkingTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = ['system', 'user', 'options', 'ui_patterns', 'file', 'image', 'bb_core', 'bb_login'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['user', 'system']);
  }

  /**
   * A destination carrying its own query string is parked unchanged.
   */
  public function testDestinationWithQueryIsParked(): void {
    $request = Request::create('/user/login', 'GET', ['destination' => '/oauth/device?user_code=TEST-CODE']);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);

    BbLoginForm::create($this->container)->buildForm([], new FormState());

    self::assertSame(
      '/oauth/device?user_code=TEST-CODE',
      $request->getSession()->get(BbOneTimeLoginController::DESTINATION_KEY),
    );
  }

}
