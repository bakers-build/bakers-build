<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\bb_login\Form\BbCodeForm;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\Entity\User;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * The code from the same mail creates the pending account too.
 *
 * @group bb_login
 */
final class SignupCodeClaimTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = ['system', 'user', 'options', 'file', 'image', 'bb_core', 'bb_login'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['user']);
  }

  /**
   * Parks an address in a fresh request's session, and pushes it.
   */
  private function pushRequestWithPendingMail(string $mail): Request {
    $request = Request::create('/user/check-mail');
    $session = new Session(new MockArraySessionStorage());
    $session->set(BbCodeForm::PENDING_MAIL_KEY, $mail);
    $request->setSession($session);
    $this->container->get('request_stack')->push($request);
    return $request;
  }

  /**
   * The code creates the pending account and signs in.
   */
  public function testTheCodeCreatesThePendingAccountAndSignsIn(): void {
    $mail = 'bycode@example.com';
    $this->pushRequestWithPendingMail($mail);
    /** @var \Drupal\bb_login\LoginCode $loginCode */
    $loginCode = $this->container->get('bb_login.login_code');
    $loginCode->issue($mail, 0);

    self::assertSame([], $this->container->get('entity_type.manager')
      ->getStorage('user')->loadByProperties(['mail' => $mail]));

    $form = BbCodeForm::create($this->container);
    $form_state = new FormState();
    // The code names a pending sign-up: `LoginCode::claim()` returns uid 0,
    // exactly as `validateForm()` would set it after a correct code.
    $form_state->set('bb_login_uid', 0);
    $form_array = [];
    $form->submitForm($form_array, $form_state);

    $accounts = $this->container->get('entity_type.manager')
      ->getStorage('user')->loadByProperties(['mail' => $mail]);
    self::assertCount(1, $accounts);
    self::assertTrue((bool) $this->container->get('current_user')->isAuthenticated());
    self::assertSame('bb_core.home', $form_state->getRedirect()->getRouteName());
  }

  /**
   * A wrong code still creates nothing.
   */
  public function testWrongCodeStillCreatesNothing(): void {
    $mail = 'wrong@example.com';
    $this->pushRequestWithPendingMail($mail);

    $form = BbCodeForm::create($this->container);
    $form_state = new FormState();
    $form_state->setValue('code', '000000');
    $form_array = [];
    $form->validateForm($form_array, $form_state);

    self::assertNotEmpty($form_state->getErrors());
    self::assertSame([], $this->container->get('entity_type.manager')
      ->getStorage('user')->loadByProperties(['mail' => $mail]));
  }

  /**
   * An account blocked meanwhile is refused, not signed in.
   */
  public function testAnAccountBlockedMeanwhileIsRefusedRatherThanSignedIn(): void {
    $mail = 'blocked-by-code@example.com';
    $this->pushRequestWithPendingMail($mail);
    // Appeared through the Google door, or a second redemption, and was then
    // blocked — still within the code's fifteen minutes.
    User::create(['name' => 'blocked-by-code', 'mail' => $mail, 'status' => 0])->save();

    $form = BbCodeForm::create($this->container);
    $form_state = new FormState();
    $form_state->set('bb_login_uid', 0);
    $form_array = [];
    $form->submitForm($form_array, $form_state);

    self::assertNotEmpty($form_state->getErrors());
    self::assertFalse((bool) $this->container->get('current_user')->isAuthenticated());
  }

}
