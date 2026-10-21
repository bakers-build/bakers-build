<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;

/**
 * The shared account-creation source, called by both entry paths.
 *
 * @group bb_login
 */
final class EmailLoginCreateAccountTest extends KernelTestBase {

  /**
   * Modules to enable.
   *
   * @var array<int, string>
   */
  protected static $modules = ['system', 'user', 'file', 'image', 'bb_core', 'bb_login'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['user']);
  }

  /**
   * Tests that account creation is public and produces a passwordless user.
   */
  public function testCreateAccountIsPublicAndPasswordless(): void {
    /** @var \Drupal\bb_login\EmailLogin $service */
    $service = $this->container->get('bb_login.email_login');
    $account = $service->createAccount('ada@example.com');

    self::assertInstanceOf(UserInterface::class, $account);
    self::assertSame('ada@example.com', $account->getEmail());
    self::assertSame('ada', $account->getAccountName());
    self::assertTrue($account->isActive());
    self::assertNull($account->getPassword());
  }

}
