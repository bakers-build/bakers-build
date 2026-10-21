<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\user\Entity\User;
use Drupal\bb_api_key\ApiKeyManager;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Real Consumer storage: legacy consumers untouched, keys fully populated.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ApiKeyStorageTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'state_machine',
    'consumers', 'simple_oauth', 'views', 'bb_core', 'bb_api_key',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('consumer');
    $this->installEntitySchema('oauth2_token');
    $this->installConfig(['user', 'simple_oauth']);
    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'grant_types' => ['client_credentials' => ['status' => TRUE]],
      'umbrella' => TRUE,
    ])->save();
  }

  /**
   * A legacy (deploy-seeded) consumer keeps NULL on both new timestamps.
   */
  public function testLegacyConsumerIsNotManaged(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $storage = $this->container->get('entity_type.manager')->getStorage('consumer');
    $legacy = $storage->create([
      'client_id' => 'bakers-someone',
      'label' => 'bakers.build agent',
      'secret' => 'a-secret',
      'user_id' => $owner->id(),
      'confidential' => TRUE,
      'grant_types' => ['client_credentials'],
    ]);
    self::assertInstanceOf(ConsumerInterface::class, $legacy);
    $legacy->save();

    $this->assertTrue($legacy->get('bb_key_created')->isEmpty());
    $this->assertTrue($legacy->get('bb_expires')->isEmpty());

    $manager = $this->container->get(ApiKeyManager::class);
    $this->assertFalse($manager->isManaged($legacy));
    $this->assertFalse($manager->isOwnedBy($legacy, $owner));
  }

  /**
   * Create() fixes every security-relevant field, regardless of input.
   */
  public function testCreatePopulatesFixedFields(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $other = $this->createUser();
    self::assertInstanceOf(User::class, $other);
    $manager = $this->container->get(ApiKeyManager::class);
    $time = $this->container->get('datetime.time');

    $expires = $time->getCurrentTime() + 86400 * 90;
    $issued = $manager->create($owner, 'Pipeline', $expires);
    $key = $issued['consumer'];

    $this->assertSame((string) $owner->id(), (string) $key->get('owner_id')->target_id);
    $this->assertSame((string) $owner->id(), (string) $key->get('user_id')->target_id);
    $this->assertTrue((bool) $key->get('confidential')->value);
    $this->assertTrue((bool) $key->get('status')->value);
    $this->assertFalse((bool) $key->get('is_default')->value);
    $this->assertSame(['client_credentials'], array_column($key->get('grant_types')->getValue(), 'value'));
    $this->assertSame(['bb_session'], array_column($key->get('scopes')->getValue(), 'scope_id'));
    $this->assertSame(ApiKeyManager::ACCESS_TOKEN_EXPIRATION, (int) $key->get('access_token_expiration')->value);
    $this->assertSame($expires, (int) $key->get('bb_expires')->value);
    $this->assertNotEmpty((int) $key->get('bb_key_created')->value);
    $this->assertStringStartsWith(ApiKeyManager::CLIENT_ID_PREFIX, (string) $key->get('client_id')->value);

    $this->assertNotSame($issued['secret'], (string) $key->get('secret')->value);
    $password_checker = $this->container->get('password');
    $this->assertTrue($password_checker->check($issued['secret'], (string) $key->get('secret')->value));

    $this->assertTrue($manager->isManaged($key));
    $this->assertTrue($manager->isOwnedBy($key, $owner));
    $this->assertFalse($manager->isOwnedBy($key, $other));
  }

  /**
   * Create() rejects a blank label and a past/expired timestamp.
   */
  public function testCreateRejectsInvalidInput(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $manager = $this->container->get(ApiKeyManager::class);
    $time = $this->container->get('datetime.time');

    $this->expectException(\InvalidArgumentException::class);
    $manager->create($owner, '   ', $time->getCurrentTime() + 86400);
  }

  /**
   * Revoke() deletes only a key the account actually owns.
   */
  public function testRevokeRejectsNonOwner(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $stranger = $this->createUser();
    self::assertInstanceOf(User::class, $stranger);
    $manager = $this->container->get(ApiKeyManager::class);
    $time = $this->container->get('datetime.time');
    $issued = $manager->create($owner, 'Pipeline', $time->getCurrentTime() + 86400);

    $this->expectException(\InvalidArgumentException::class);
    $manager->revoke($issued['consumer'], $stranger);
  }

  /**
   * Deleting a managed key revokes its issued tokens synchronously.
   */
  public function testDeletingKeyRevokesIssuedTokens(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $manager = $this->container->get(ApiKeyManager::class);
    $time = $this->container->get('datetime.time');
    $issued = $manager->create($owner, 'Pipeline', $time->getCurrentTime() + 86400);
    $consumer = $issued['consumer'];

    $token_storage = $this->container->get('entity_type.manager')->getStorage('oauth2_token');
    $token = $token_storage->create([
      'auth_user_id' => $owner->id(),
      'client' => $consumer->id(),
      'bundle' => 'access_token',
      'value' => bin2hex(random_bytes(16)),
      'expire' => $time->getCurrentTime() + 300,
      'scopes' => [['target_id' => 'bb_session']],
    ]);
    $token->save();
    $token_id = $token->id();

    $manager->revoke($consumer, $owner);

    $this->assertNull($token_storage->load($token_id));
    $storage = $this->container->get('entity_type.manager')->getStorage('consumer');
    $this->assertNull($storage->load($consumer->id()));
  }

}
