<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login_oauth\Kernel;

use Drupal\Core\Logger\RfcLoggerTrait;
use Drupal\Core\Logger\RfcLogLevel;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_login_oauth\BbGoogleAuthManager;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\file\Entity\File;
use Drupal\file\FileInterface;
use Drupal\social_auth\User\SocialAuthUser;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use Psr\Log\LoggerInterface;

/**
 * A provider sign-in fills an empty profile picture, and only an empty one.
 *
 * Drives `authenticateUser()` like `VerifiedEmailAuthenticatorTest`; Google
 * is a Guzzle `MockHandler` behind `http_client`, so bytes and failures are
 * deterministic.
 *
 * @group bb_login_oauth
 */
final class ProviderPictureTest extends KernelTestBase implements LoggerInterface {

  use RfcLoggerTrait;

  private const PICTURE_URL = 'https://lh3.example.com/a/picture';

  private const PICTURE_BYTES = 'google-picture-bytes';

  /**
   * The modules under test.
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'field', 'file', 'image', 'bb_core', 'bb_login',
    'social_api', 'social_auth', 'social_auth_google', 'bb_login_oauth',
  ];

  /**
   * What Google answers, in order.
   */
  private MockHandler $google;

  /**
   * Warnings logged on the `bb_login_oauth` channel.
   *
   * @var array<int, string>
   */
  private array $warnings = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('file');
    $this->installEntitySchema('social_auth');
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['user', 'social_auth']);
    // See VerifiedEmailAuthenticatorTest: the site's setting, and uid 1
    // reserved so `disable_admin_login` does not refuse the fixtures.
    $this->config('user.settings')->set('register', 'admin_only')->save();
    User::create(['name' => 'root', 'mail' => 'root@example.com', 'status' => 1])->save();

    FieldStorageConfig::create([
      'field_name' => 'user_picture',
      'entity_type' => 'user',
      'type' => 'image',
    ])->save();
    FieldConfig::create([
      'field_name' => 'user_picture',
      'entity_type' => 'user',
      'bundle' => 'user',
      'settings' => ['file_directory' => 'pictures/[date:custom:Y]-[date:custom:m]'],
    ])->save();

    $this->google = new MockHandler();
    $this->container->set('http_client', new Client(['handler' => HandlerStack::create($this->google)]));
    $this->container->get('logger.factory')->addLogger($this);
  }

  /**
   * {@inheritdoc}
   */
  public function log($level, string|\Stringable $message, array $context = []): void {
    if ($level === RfcLogLevel::WARNING && ($context['channel'] ?? '') === 'bb_login_oauth') {
      $this->warnings[] = (string) $message;
    }
  }

  /**
   * A new account gets the picture Google served, owned and used by it.
   */
  public function testNewAccountGetsTheProviderPicture(): void {
    $this->google->append(new Response(200, [], self::PICTURE_BYTES));

    $this->signIn('grace@example.com', self::PICTURE_URL);

    $account = $this->account('grace@example.com');
    $file = $account->get('user_picture')->entity;
    self::assertInstanceOf(FileInterface::class, $file, 'the new account has a picture');
    self::assertSame(self::PICTURE_BYTES, file_get_contents($file->getFileUri()));
    self::assertStringStartsWith('public://pictures/' . date('Y-m') . '/', $file->getFileUri());
    self::assertSame($account->id(), $file->getOwnerId());
    self::assertTrue($file->isPermanent());
    self::assertEquals(['file' => ['user' => [$account->id() => 1]]], \Drupal::service('file.usage')->listUsage($file));
  }

  /**
   * An existing account without a picture is filled on an e-mail match.
   */
  public function testExistingAccountWithoutPictureIsFilled(): void {
    User::create(['name' => 'ada', 'mail' => 'ada@example.com', 'status' => 1])->save();
    $this->google->append(new Response(200, [], self::PICTURE_BYTES));

    $this->signIn('ada@example.com', self::PICTURE_URL);

    $file = $this->account('ada@example.com')->get('user_picture')->entity;
    self::assertInstanceOf(FileInterface::class, $file);
    self::assertSame(self::PICTURE_BYTES, file_get_contents($file->getFileUri()));
  }

  /**
   * An account already linked to Google is filled on its next sign-in.
   */
  public function testLinkedAccountWithoutPictureIsFilled(): void {
    User::create(['name' => 'ada', 'mail' => 'ada@example.com', 'status' => 1])->save();
    $this->signIn('ada@example.com', NULL);
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    self::assertTrue($this->account('ada@example.com')->get('user_picture')->isEmpty());
    $this->google->append(new Response(200, [], self::PICTURE_BYTES));

    $this->signIn('ada@example.com', self::PICTURE_URL);

    self::assertFalse($this->account('ada@example.com')->get('user_picture')->isEmpty());
  }

  /**
   * A picture the person set is never replaced, and Google is not asked.
   */
  public function testOwnPictureIsNeverReplaced(): void {
    $own = File::create(['uri' => 'public://own.png']);
    $own->save();
    User::create(['name' => 'ada', 'mail' => 'ada@example.com', 'status' => 1, 'user_picture' => $own->id()])->save();
    $this->google->append(new Response(200, [], self::PICTURE_BYTES));

    $this->signIn('ada@example.com', self::PICTURE_URL);

    self::assertTrue(\Drupal::currentUser()->isAuthenticated());
    self::assertSame($own->id(), $this->account('ada@example.com')->get('user_picture')->target_id);
    self::assertCount(1, $this->google, 'Google was not asked for the picture');
  }

  /**
   * A failed download leaves the sign-in untouched and is only logged.
   */
  public function testFailedDownloadStillSignsIn(): void {
    $this->google->append(new Response(500));

    $this->signIn('grace@example.com', self::PICTURE_URL);

    self::assertTrue(\Drupal::currentUser()->isAuthenticated());
    self::assertTrue($this->account('grace@example.com')->get('user_picture')->isEmpty());
    self::assertSame([], \Drupal::messenger()->messagesByType('error'));
    self::assertCount(1, $this->warnings);
  }

  /**
   * Without a picture URL nothing is downloaded.
   */
  public function testNoPictureUrlDownloadsNothing(): void {
    $this->google->append(new Response(200, [], self::PICTURE_BYTES));

    $this->signIn('grace@example.com', NULL);

    self::assertTrue(\Drupal::currentUser()->isAuthenticated());
    self::assertTrue($this->account('grace@example.com')->get('user_picture')->isEmpty());
    self::assertCount(1, $this->google, 'Google was not asked for a picture');
  }

  /**
   * Signs in through Google with a confirmed address.
   */
  private function signIn(string $mail, ?string $picture_url): void {
    $authenticator = $this->container->get('social_auth.user_authenticator');
    $authenticator->setPluginId('social_auth_google');
    $authenticator->authenticateUser(new SocialAuthUser(
      'Person', 'google-' . $mail, 'token', $mail, $picture_url,
      [BbGoogleAuthManager::VERIFIED_KEY => TRUE],
    ));
  }

  /**
   * Loads the account holding an address, fresh from storage.
   */
  private function account(string $mail): UserInterface {
    $this->container->get('entity_type.manager')->getStorage('user')->resetCache();
    $account = user_load_by_mail($mail);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

}
