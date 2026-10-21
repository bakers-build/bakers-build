<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\user\Entity\User;
use Symfony\Component\Yaml\Yaml;

/**
 * An unknown address creates no account until its link or code is redeemed.
 *
 * @group bb_login
 */
final class DeferredAccountCreationTest extends KernelTestBase {

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
    $this->installConfig(['user', 'system']);
    $this->config('system.mail')->set('interface.default', 'test_mail_collector')->save();
    // KERNEL TESTS SEE THE MODULE'S SHIPPED DEFAULT, NOT `config/sync/`: that
    // override only applies through a real site install (recipe or CIM), so
    // the shipped body is loaded from the actual file rather than retyped
    // here — a change to the shipped text now moves this test's fixture with
    // it instead of leaving it green against a stale copy.
    $shipped = $this->shippedRegisterMail();
    $this->config('user.mail')
      ->set('register_no_approval_required.body', $shipped['body'])
      ->save();
  }

  /**
   * The `register_no_approval_required` template as `config/sync/` ships it.
   *
   * @return array{subject: string, body: string}
   *   The subject and body.
   */
  private function shippedRegisterMail(): array {
    $path = \Drupal::root() . '/../config/sync/user.mail.yml';
    $config = Yaml::parseFile($path);
    return $config['register_no_approval_required'];
  }

  /**
   * The recipe's `simpleConfigUpdate` for the same template must agree.
   *
   * Both install paths — CIM from `config/sync/` and the recipe path — carry
   * this template, and a change made in only one of them passes every gate
   * except the final `ddev init`, the most expensive one there is. Comparing
   * the two files directly catches that mismatch here instead.
   */
  public function testTheTwoConfigHomesAgreeOnTheRegisterTemplate(): void {
    $shipped = $this->shippedRegisterMail();
    $recipe = Yaml::parseFile(\Drupal::root() . '/../recipes/bakers/recipe.yml');
    $recipeMail = $recipe['config']['actions']['user.mail']['simpleConfigUpdate']['register_no_approval_required'];

    self::assertSame($shipped['subject'], $recipeMail['subject']);
    self::assertSame($shipped['body'], $recipeMail['body']);
  }

  /**
   * An unknown address is mailed both halves of the credential, no account.
   */
  public function testAnUnknownAddressCreatesNoAccountAndStillMailsBothHalves(): void {
    /** @var \Drupal\bb_login\EmailLogin $service */
    $service = $this->container->get('bb_login.email_login');
    $service->requestLoginLink('nobody@example.com');

    $accounts = $this->container->get('entity_type.manager')->getStorage('user')
      ->loadByProperties(['mail' => 'nobody@example.com']);
    self::assertSame([], $accounts, 'submitting an address must create no account');

    $mails = $this->container->get('state')->get('system.test_mail_collector', []);
    self::assertCount(1, $mails);
    $body = (string) $mails[0]['body'];
    self::assertMatchesRegularExpression('#/user/claim/\S+#', $body);
    self::assertMatchesRegularExpression('/(?:^|\s)\d{6}(?:\s|$)/', $body);
    self::assertStringNotContainsString('Your account has been created', $body);
  }

  /**
   * An already-registered address still travels on core's one-time link.
   */
  public function testKnownAddressStillTravelsOnCoresOneTimeLink(): void {
    $known = User::create(['name' => 'ada', 'mail' => 'ada@example.com', 'status' => 1]);
    $known->save();

    $this->container->get('bb_login.email_login')->requestLoginLink('ada@example.com');

    $mails = $this->container->get('state')->get('system.test_mail_collector', []);
    self::assertCount(1, $mails);
    self::assertSame('user', $mails[0]['module']);
    self::assertSame('password_reset', $mails[0]['key']);
    self::assertStringContainsString('/user/reset/' . $known->id() . '/', (string) $mails[0]['body']);
  }

}
