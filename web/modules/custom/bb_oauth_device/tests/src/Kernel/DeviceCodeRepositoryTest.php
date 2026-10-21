<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_oauth_device\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\consumers\Entity\Consumer;
use Drupal\simple_oauth\Entities\ClientEntity;

/**
 * Tests device code persistence in the expirable key-value store.
 *
 * @group bb_oauth_device
 */
class DeviceCodeRepositoryTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'user',
    'system',
    'file',
    'image',
    'options',
    'serialization',
    'consumers',
    'simple_oauth',
    'bb_oauth_device',
  ];

  /**
   * The repository under test.
   *
   * @var \Drupal\bb_oauth_device\Repositories\DeviceCodeRepository
   */
  protected $repository;

  /**
   * The client entity device codes are issued to.
   */
  protected ClientEntity $client;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('consumer');
    $this->installConfig(['simple_oauth']);

    $consumer = Consumer::create([
      'client_id' => 'device-test',
      'label' => 'Device test client',
      'confidential' => FALSE,
      'grant_types' => ['device_code'],
      'access_token_expiration' => 300,
    ]);
    $consumer->save();
    $this->client = new ClientEntity($consumer);

    $this->repository = $this->container->get('bb_oauth_device.repositories.device_code');
  }

  /**
   * A persisted device code is readable by device code and by user code.
   */
  public function testRoundTripByBothKeys(): void {
    $code = $this->repository->getNewDeviceCode();
    $code->setIdentifier('DEVICECODE1');
    $code->setUserCode('WDJBMJHT');
    $code->setClient($this->client);
    $code->setInterval(5);
    $code->setVerificationUri('https://example.com/oauth/device');
    $code->setExpiryDateTime(new \DateTimeImmutable('+10 minutes'));
    $this->repository->persistDeviceCode($code);

    $byDeviceCode = $this->repository->getDeviceCodeEntityByDeviceCode('DEVICECODE1');
    $this->assertNotNull($byDeviceCode);
    $this->assertSame('WDJBMJHT', $byDeviceCode->getUserCode());
    $this->assertSame(5, $byDeviceCode->getInterval());
    $this->assertSame('device-test', $byDeviceCode->getClient()->getIdentifier());
    $this->assertNull($byDeviceCode->getUserIdentifier());
    $this->assertFalse($byDeviceCode->getUserApproved());

    $byUserCode = $this->repository->getDeviceCodeEntityByUserCode('WDJBMJHT');
    $this->assertNotNull($byUserCode);
    $this->assertSame('DEVICECODE1', $byUserCode->getIdentifier());
  }

  /**
   * Approval and the poll timestamp survive a second persist.
   */
  public function testApprovalIsPersisted(): void {
    $code = $this->repository->getNewDeviceCode();
    $code->setIdentifier('DEVICECODE2');
    $code->setUserCode('BDWDJPJT');
    $code->setClient($this->client);
    $code->setInterval(5);
    $code->setVerificationUri('https://example.com/oauth/device');
    $code->setExpiryDateTime(new \DateTimeImmutable('+10 minutes'));
    $this->repository->persistDeviceCode($code);

    $code->setUserIdentifier('7');
    $code->setUserApproved(TRUE);
    $code->setLastPolledAt(new \DateTimeImmutable('@1700000000'));
    $this->repository->persistDeviceCode($code);

    $reloaded = $this->repository->getDeviceCodeEntityByDeviceCode('DEVICECODE2');
    $this->assertSame('7', $reloaded->getUserIdentifier());
    $this->assertTrue($reloaded->getUserApproved());
    $this->assertSame(1700000000, $reloaded->getLastPolledAt()->getTimestamp());
  }

  /**
   * Revoking removes both keys and reports the code as revoked.
   */
  public function testRevokeClearsBothKeys(): void {
    $code = $this->repository->getNewDeviceCode();
    $code->setIdentifier('DEVICECODE3');
    $code->setUserCode('QRSTUVWX');
    $code->setClient($this->client);
    $code->setInterval(5);
    $code->setVerificationUri('https://example.com/oauth/device');
    $code->setExpiryDateTime(new \DateTimeImmutable('+10 minutes'));
    $this->repository->persistDeviceCode($code);

    $this->repository->revokeDeviceCode('DEVICECODE3');

    $this->assertTrue($this->repository->isDeviceCodeRevoked('DEVICECODE3'));
    $this->assertNull($this->repository->getDeviceCodeEntityByDeviceCode('DEVICECODE3'));
    $this->assertNull($this->repository->getDeviceCodeEntityByUserCode('QRSTUVWX'));
  }

  /**
   * An unknown code counts as revoked rather than as a usable code.
   */
  public function testUnknownCodeIsRevoked(): void {
    $this->assertTrue($this->repository->isDeviceCodeRevoked('NEVERISSUED'));
    $this->assertNull($this->repository->getDeviceCodeEntityByDeviceCode('NEVERISSUED'));
  }

  /**
   * A code past its logical expiry is still readable during the grace window.
   *
   * K-1.
   *
   * league's DeviceCodeGrant only reaches its own `expired_token` branch if
   * getDeviceCodeEntityByDeviceCode() still returns an entity after
   * getExpiryDateTime() has passed; without the grace window the expirable
   * key-value store's own `expire > now` filter deletes the row at that exact
   * instant and league throws invalid_grant instead. This asserts the
   * repository half of that fix directly, in the store's own time frame.
   */
  public function testCodePastLogicalExpiryIsStillReadableDuringGrace(): void {
    $code = $this->repository->getNewDeviceCode();
    $code->setIdentifier('DEVICECODE4');
    $code->setUserCode('EXPIREDGR');
    $code->setClient($this->client);
    $code->setInterval(5);
    $code->setVerificationUri('https://example.com/oauth/device');
    // Persisted with a lifetime still positive, so it is actually stored;
    // real issuance never persists an already-expired code.
    $code->setExpiryDateTime(new \DateTimeImmutable('+1 second'));
    $this->repository->persistDeviceCode($code);
    sleep(2);

    $reloaded = $this->repository->getDeviceCodeEntityByDeviceCode('DEVICECODE4');
    $this->assertNotNull($reloaded, 'The row must outlive its own logical expiry for expired_token to be reachable.');
    $this->assertLessThan(time(), $reloaded->getExpiryDateTime()->getTimestamp());
  }

  /**
   * The "code:" row's stored expiry outlives the "user:" row's (I-1).
   *
   * Unlike the two tests above, this reads {key_value_expire} directly
   * instead of going back through the repository: both `sleep()` in a kernel
   * test and DeviceAuthorizationFlowTest's own `setWithExpire()` overwrite
   * are blind to the store's request-time expiry column, so neither
   * discriminates when EXPIRY_GRACE_SECONDS is reverted to 0. Comparing the
   * two stored `expire` columns does not depend on wall-clock drift at all.
   */
  public function testCodeRowExpiresSixtySecondsAfterUserRow(): void {
    $code = $this->repository->getNewDeviceCode();
    $code->setIdentifier('DEVICECODE5');
    $code->setUserCode('GRACEDELTA');
    $code->setClient($this->client);
    $code->setInterval(5);
    $code->setVerificationUri('https://example.com/oauth/device');
    $code->setExpiryDateTime(new \DateTimeImmutable('+10 minutes'));
    $this->repository->persistDeviceCode($code);

    $connection = \Drupal::database();
    $collection = 'bb_oauth_device_code';
    $codeExpire = (int) $connection->select('key_value_expire', 'k')
      ->fields('k', ['expire'])
      ->condition('collection', $collection)
      ->condition('name', 'code:DEVICECODE5')
      ->execute()
      ->fetchField();
    $userExpire = (int) $connection->select('key_value_expire', 'k')
      ->fields('k', ['expire'])
      ->condition('collection', $collection)
      ->condition('name', 'user:GRACEDELTA')
      ->execute()
      ->fetchField();

    $this->assertSame(60, $codeExpire - $userExpire, 'The "code:" row must outlive the "user:" row by exactly EXPIRY_GRACE_SECONDS.');
  }

}
