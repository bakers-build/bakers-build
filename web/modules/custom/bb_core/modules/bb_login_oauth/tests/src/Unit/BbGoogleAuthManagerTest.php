<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login_oauth\Unit;

use Drupal\Core\Config\ConfigFactory;
use Drupal\Core\Config\ImmutableConfig;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Drupal\Tests\UnitTestCase;
use Drupal\bb_login_oauth\BbGoogleAuthManager;
use League\OAuth2\Client\Provider\Google;
use League\OAuth2\Client\Provider\GoogleUser;
use League\OAuth2\Client\Token\AccessToken;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * The verified-address assertion the decorator reads.
 *
 * @group bb_login_oauth
 */
final class BbGoogleAuthManagerTest extends UnitTestCase {

  /**
   * The key is a public contract Task 5 and Task 8 both consume by name.
   */
  public function testVerifiedKeyIsStable(): void {
    // A regression guard on a literal-typed constant: PHPStan narrows the
    // constant to the exact string it is declared with, so it correctly
    // reads a rename of either side as "always true" from its own static
    // vantage point — the point of the test is a human catching that rename.
    // @phpstan-ignore staticMethod.alreadyNarrowedType
    self::assertSame('bb_email_verified', BbGoogleAuthManager::VERIFIED_KEY);
  }

  /**
   * Confirms `getUserInfo()` writes the assertion where the decorator reads it.
   *
   * Review finding 3: the previous version of this test asserted only the
   * constant's value — a tautology that could not catch the review's
   * finding 1, where the assertion landed in `customData` instead of
   * `additionalData`. This drives `getUserInfo()` itself and reads the
   * result back through `getAdditionalData()`, the same accessor
   * `UserAuthenticator::authenticateUser()` calls in production.
   *
   * @dataProvider verifiedClaimProvider
   */
  public function testGetUserInfoWritesTheClaimIntoAdditionalData(?bool $email_verified, bool $expected): void {
    $settings = $this->createMock(ImmutableConfig::class);
    $settings->method('get')->willReturn('');
    $config_factory = $this->createMock(ConfigFactory::class);
    $config_factory->method('get')->willReturn($settings);
    $logger_factory = $this->createMock(LoggerChannelFactoryInterface::class);
    $request_stack = new RequestStack();

    $owner = $this->createMock(GoogleUser::class);
    $owner->method('getName')->willReturn('Ada Lovelace');
    $owner->method('getId')->willReturn('google-1');
    $owner->method('getEmail')->willReturn('ada@example.com');
    $owner->method('getAvatar')->willReturn(NULL);
    $owner->method('getFirstName')->willReturn('Ada');
    $owner->method('getLastName')->willReturn('Lovelace');
    $owner->method('getEmailVerified')->willReturn($email_verified);

    $client = $this->createMock(Google::class);
    $client->method('getResourceOwner')->willReturn($owner);

    $manager = new BbGoogleAuthManager($config_factory, $logger_factory, $request_stack);
    $manager->setClient($client);
    $manager->setAccessToken(new AccessToken(['access_token' => 'token']));

    $user = $manager->getUserInfo();

    self::assertSame($expected, $user->getAdditionalData()[BbGoogleAuthManager::VERIFIED_KEY] ?? NULL);
  }

  /**
   * Data for {@see self::testGetUserInfoWritesTheClaimIntoAdditionalData()}.
   *
   * @return array<string, array{0: bool|null, 1: bool}>
   *   The verification claim and the assertion it must produce.
   */
  public static function verifiedClaimProvider(): array {
    return [
      'Google confirms it' => [TRUE, TRUE],
      'Google denies it' => [FALSE, FALSE],
      'Google omits the claim' => [NULL, FALSE],
    ];
  }

}
