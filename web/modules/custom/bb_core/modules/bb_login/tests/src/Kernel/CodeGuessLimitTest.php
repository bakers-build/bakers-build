<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\bb_login\Form\BbCodeForm;
use Drupal\KernelTests\KernelTestBase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Wrong codes are limited per client, not only per address.
 *
 * @group bb_login
 */
final class CodeGuessLimitTest extends KernelTestBase {

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
   * One client spreading wrong codes over many addresses is refused.
   */
  public function testWrongCodesSpreadOverAddressesAreRefusedPerClient(): void {
    /** @var \Drupal\bb_login\LoginCode $loginCode */
    $loginCode = $this->container->get('bb_login.login_code');
    $answers = [];
    foreach (range(1, 5) as $n) {
      $mail = "guess-$n@example.com";
      $code = $loginCode->issue($mail, 0);
      $wrong = str_pad((string) (((int) $code + 1) % 1000000), 6, '0', STR_PAD_LEFT);
      for ($i = 0; $i < 5; $i++) {
        $answers[] = $this->offer($mail, $wrong, '203.0.113.7');
      }
    }

    self::assertSame(array_fill(0, 20, 'This code is wrong or has expired.'), array_slice($answers, 0, 20));
    self::assertSame(array_fill(0, 5, 'Too many attempts. Please request a new login link.'), array_slice($answers, 20));
    self::assertSame('This code is wrong or has expired.', $this->offer('other@example.com', '000000', '198.51.100.9'));
  }

  /**
   * Offers a code from a client IP and returns the form's answer.
   */
  private function offer(string $mail, string $code, string $ip): string {
    $request = Request::create('/user/check-mail', 'POST', [], [], [], ['REMOTE_ADDR' => $ip]);
    $session = new Session(new MockArraySessionStorage());
    $session->set(BbCodeForm::PENDING_MAIL_KEY, $mail);
    $request->setSession($session);
    $this->container->get('request_stack')->push($request);

    $form_state = new FormState();
    $form_state->setValue('code', $code);
    $form = [];
    BbCodeForm::create($this->container)->validateForm($form, $form_state);
    $this->container->get('request_stack')->pop();

    return (string) ($form_state->getErrors()['code'] ?? '');
  }

}
