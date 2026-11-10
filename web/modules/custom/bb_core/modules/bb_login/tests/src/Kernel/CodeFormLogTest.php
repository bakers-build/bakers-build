<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\Core\Logger\RfcLogLevel;
use Drupal\bb_login\Form\BbCodeForm;
use Drupal\bb_login\LoginCode;
use Drupal\KernelTests\KernelTestBase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Wrong login codes and the attempt limit leave a trace in the site log.
 *
 * @group bb_login
 */
final class CodeFormLogTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = ['system', 'user', 'options', 'file', 'image', 'dblog', 'bb_core', 'bb_login'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installSchema('dblog', ['watchdog']);
    $this->installConfig(['user']);
    $request = Request::create('/user/check-mail');
    $session = new Session(new MockArraySessionStorage());
    $session->set(BbCodeForm::PENDING_MAIL_KEY, 'guess@example.com');
    $request->setSession($session);
    $this->container->get('request_stack')->push($request);
  }

  /**
   * Each wrong code and each refusal past the limit is one notice.
   */
  public function testWrongCodesAndTheAttemptLimitAreLogged(): void {
    for ($attempt = 0; $attempt <= LoginCode::MAX_ATTEMPTS; $attempt++) {
      $form_state = (new FormState())->setValue('code', '000000');
      $form_array = [];
      BbCodeForm::create($this->container)->validateForm($form_array, $form_state);
      self::assertNotEmpty($form_state->getErrors());
    }

    $rows = $this->container->get('database')->select('watchdog', 'w')
      ->fields('w', ['message', 'severity'])
      ->condition('type', 'bb_login')
      ->orderBy('wid')
      ->execute()->fetchAll(\PDO::FETCH_ASSOC);
    $messages = array_column($rows, 'message');
    self::assertSame(
      array_merge(array_fill(0, LoginCode::MAX_ATTEMPTS, 'Wrong login code for %mail.'), ['Login code attempts blocked for %mail.']),
      $messages,
    );
    self::assertSame([RfcLogLevel::NOTICE], array_values(array_unique(array_map('intval', array_column($rows, 'severity')))));
  }

  /**
   * With dblog on, an access denial reaches the log through core.
   */
  public function testAccessDenialIsLogged(): void {
    $this->installEntitySchema('bb_workspace');
    // The 403 page renders bb_theme components.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->container->get('router.builder')->rebuild();
    $response = $this->container->get('http_kernel')->handle(Request::create('/admin'));
    self::assertSame(403, $response->getStatusCode());
    $count = $this->container->get('database')->select('watchdog', 'w')
      ->condition('type', 'access denied')
      ->countQuery()->execute()->fetchField();
    self::assertSame(1, (int) $count);
  }

}
