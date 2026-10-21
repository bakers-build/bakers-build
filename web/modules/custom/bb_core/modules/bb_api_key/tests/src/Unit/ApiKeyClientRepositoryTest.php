<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Unit;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Tests\UnitTestCase;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\bb_api_key\OAuth\ApiKeyClientRepository;
use Drupal\user\UserInterface;
use League\OAuth2\Server\Repositories\ClientRepositoryInterface;
use PHPUnit\Framework\Attributes\Group;

/**
 * Managed-key client validation: valid, damaged, and ordinary consumers.
 *
 * The time service is fixed to a known instant so "just before/at/after
 * expiry" are exact boundary assertions, not racy wall-clock comparisons.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
final class ApiKeyClientRepositoryTest extends UnitTestCase {

  private const NOW = 1_000_000;

  /**
   * Builds a consumer test double with the given field values.
   *
   * @param array<string, mixed> $values
   *   Field name to raw value (or UserInterface for reference fields).
   */
  private function consumer(array $values): ConsumerInterface {
    $consumer = $this->createMock(ConsumerInterface::class);
    $consumer->method('get')->willReturnCallback(function (string $name) use ($values) {
      $field = $this->createMock(FieldItemListInterface::class);
      $value = $values[$name] ?? NULL;
      $field->method('__get')->willReturnCallback(fn ($property) => match ($property) {
        'value' => is_array($value) ? NULL : $value,
        'target_id' => $value instanceof UserInterface ? $value->id() : $value,
        'entity' => $value instanceof UserInterface ? $value : NULL,
        default => NULL,
      });
      $field->method('getValue')->willReturn($value ?? []);
      $field->method('isEmpty')->willReturn($value === NULL || $value === '');
      return $field;
    });
    return $consumer;
  }

  /**
   * Builds a decorator around an inner repository test double.
   */
  private function repository(ClientRepositoryInterface $inner, ?ConsumerInterface $consumer): ApiKeyClientRepository {
    $storage = $this->createMock(EntityStorageInterface::class);
    $storage->method('loadByProperties')->willReturn($consumer ? ['x' => $consumer] : []);
    $entityTypeManager = $this->createMock(EntityTypeManagerInterface::class);
    $entityTypeManager->method('getStorage')->with('consumer')->willReturn($storage);
    $time = $this->createMock(TimeInterface::class);
    $time->method('getCurrentTime')->willReturn(self::NOW);
    return new ApiKeyClientRepository($inner, $entityTypeManager, new ApiKeyManager($entityTypeManager, $time), $time);
  }

  /**
   * A complete set of valid field values for a managed key.
   */
  private function validManagedValues(UserInterface $owner, int $expires): array {
    return [
      'client_id' => ApiKeyManager::CLIENT_ID_PREFIX . 'abc',
      'bb_key_created' => self::NOW - 10,
      'bb_expires' => $expires,
      'status' => TRUE,
      'confidential' => TRUE,
      'grant_types' => [['value' => 'client_credentials']],
      'scopes' => [['scope_id' => 'bb_session']],
      'owner_id' => $owner,
      'user_id' => $owner,
    ];
  }

  /**
   * A valid managed key delegates credential validation to the inner repo.
   */
  public function testValidManagedKeyDelegatesToInner(): void {
    $owner = $this->createMock(UserInterface::class);
    $owner->method('id')->willReturn(7);
    $owner->method('isActive')->willReturn(TRUE);
    $consumer = $this->consumer($this->validManagedValues($owner, self::NOW + 100));

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->once())->method('validateClient')->willReturn(TRUE);

    $repository = $this->repository($inner, $consumer);
    $this->assertTrue($repository->validateClient('bakers-key-abc', 'secret', 'client_credentials'));
  }

  /**
   * An expired managed key fails closed without delegating.
   */
  public function testExpiredManagedKeyFailsClosedWithoutDelegating(): void {
    $owner = $this->createMock(UserInterface::class);
    $owner->method('id')->willReturn(7);
    $owner->method('isActive')->willReturn(TRUE);
    $consumer = $this->consumer($this->validManagedValues($owner, self::NOW - 1));

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->never())->method('validateClient');

    $repository = $this->repository($inner, $consumer);
    $this->assertFalse($repository->validateClient('bakers-key-abc', 'secret', 'client_credentials'));
  }

  /**
   * A key expiring exactly now fails closed.
   */
  public function testExpiringExactlyNowFailsClosed(): void {
    $owner = $this->createMock(UserInterface::class);
    $owner->method('id')->willReturn(7);
    $owner->method('isActive')->willReturn(TRUE);
    $consumer = $this->consumer($this->validManagedValues($owner, self::NOW));

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->never())->method('validateClient');

    $repository = $this->repository($inner, $consumer);
    $this->assertFalse($repository->validateClient('bakers-key-abc', 'secret', 'client_credentials'));
  }

  /**
   * A disabled managed key fails closed.
   */
  public function testDisabledManagedKeyFailsClosed(): void {
    $owner = $this->createMock(UserInterface::class);
    $owner->method('id')->willReturn(7);
    $owner->method('isActive')->willReturn(TRUE);
    $values = $this->validManagedValues($owner, self::NOW + 100);
    $values['status'] = FALSE;
    $consumer = $this->consumer($values);

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->never())->method('validateClient');

    $repository = $this->repository($inner, $consumer);
    $this->assertFalse($repository->validateClient('bakers-key-abc', 'secret', 'client_credentials'));
  }

  /**
   * A managed key whose owner_id and user_id disagree fails closed.
   */
  public function testMismatchedOwnerFailsClosed(): void {
    $owner = $this->createMock(UserInterface::class);
    $owner->method('id')->willReturn(7);
    $other = $this->createMock(UserInterface::class);
    $other->method('id')->willReturn(9);
    $values = $this->validManagedValues($owner, self::NOW + 100);
    $values['user_id'] = $other;
    $consumer = $this->consumer($values);

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->never())->method('validateClient');

    $repository = $this->repository($inner, $consumer);
    $this->assertFalse($repository->validateClient('bakers-key-abc', 'secret', 'client_credentials'));
  }

  /**
   * A managed key with a grant other than client_credentials fails closed.
   */
  public function testModifiedGrantFailsClosed(): void {
    $owner = $this->createMock(UserInterface::class);
    $owner->method('id')->willReturn(7);
    $owner->method('isActive')->willReturn(TRUE);
    $values = $this->validManagedValues($owner, self::NOW + 100);
    $values['grant_types'] = [['value' => 'authorization_code']];
    $consumer = $this->consumer($values);

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->never())->method('validateClient');

    $repository = $this->repository($inner, $consumer);
    $this->assertFalse($repository->validateClient('bakers-key-abc', 'secret', 'client_credentials'));
  }

  /**
   * A reserved-prefix client_id missing its marker fails closed.
   */
  public function testDamagedMarkerOnReservedPrefixFailsClosed(): void {
    $owner = $this->createMock(UserInterface::class);
    $owner->method('id')->willReturn(7);
    $values = $this->validManagedValues($owner, self::NOW + 100);
    // A client_id carrying the reserved prefix but no bb_key_created marker:
    // never silently falls back to unlimited legacy-consumer behavior.
    $values['bb_key_created'] = NULL;
    $consumer = $this->consumer($values);

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->never())->method('validateClient');

    $repository = $this->repository($inner, $consumer);
    $this->assertFalse($repository->validateClient('bakers-key-abc', 'secret', 'client_credentials'));
  }

  /**
   * An ordinary legacy consumer delegates unchanged.
   */
  public function testOrdinaryLegacyClientDelegatesUnchanged(): void {
    $owner = $this->createMock(UserInterface::class);
    $owner->method('id')->willReturn(7);
    $consumer = $this->consumer([
      'client_id' => 'bakers-cw',
      'bb_key_created' => NULL,
      'user_id' => $owner,
      'owner_id' => $owner,
      'status' => TRUE,
      'confidential' => TRUE,
      'grant_types' => [['value' => 'client_credentials']],
      'scopes' => [['scope_id' => 'bb_session']],
    ]);

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->once())->method('validateClient')->willReturn(TRUE);

    $repository = $this->repository($inner, $consumer);
    $this->assertTrue($repository->validateClient('bakers-cw', 'secret', 'client_credentials'));
  }

  /**
   * A managed key whose owner account is blocked fails closed.
   */
  public function testBlockedOwnerFailsClosed(): void {
    $owner = $this->createMock(UserInterface::class);
    $owner->method('id')->willReturn(7);
    $owner->method('isActive')->willReturn(FALSE);
    $consumer = $this->consumer($this->validManagedValues($owner, self::NOW + 100));

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->never())->method('validateClient');

    $repository = $this->repository($inner, $consumer);
    $this->assertFalse($repository->validateClient('bakers-key-abc', 'secret', 'client_credentials'));
  }

  /**
   * A managed key whose owner account no longer exists fails closed.
   */
  public function testDeletedOwnerFailsClosed(): void {
    $values = $this->validManagedValues($this->createMock(UserInterface::class), self::NOW + 100);
    $values['owner_id'] = 7;
    $values['user_id'] = 7;
    $consumer = $this->consumer($values);

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->never())->method('validateClient');

    $repository = $this->repository($inner, $consumer);
    $this->assertFalse($repository->validateClient('bakers-key-abc', 'secret', 'client_credentials'));
  }

  /**
   * A managed key whose confidential flag has been turned off fails closed.
   */
  public function testNonConfidentialFailsClosed(): void {
    $owner = $this->createMock(UserInterface::class);
    $owner->method('id')->willReturn(7);
    $owner->method('isActive')->willReturn(TRUE);
    $values = $this->validManagedValues($owner, self::NOW + 100);
    $values['confidential'] = FALSE;
    $consumer = $this->consumer($values);

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->never())->method('validateClient');

    $repository = $this->repository($inner, $consumer);
    $this->assertFalse($repository->validateClient('bakers-key-abc', 'secret', 'client_credentials'));
  }

  /**
   * A managed key whose scope changed away from bb_session fails closed.
   */
  public function testChangedScopeFailsClosed(): void {
    $owner = $this->createMock(UserInterface::class);
    $owner->method('id')->willReturn(7);
    $owner->method('isActive')->willReturn(TRUE);
    $values = $this->validManagedValues($owner, self::NOW + 100);
    $values['scopes'] = [['scope_id' => 'some_other_scope']];
    $consumer = $this->consumer($values);

    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->never())->method('validateClient');

    $repository = $this->repository($inner, $consumer);
    $this->assertFalse($repository->validateClient('bakers-key-abc', 'secret', 'client_credentials'));
  }

  /**
   * An unknown client_id delegates unchanged.
   */
  public function testUnknownClientDelegatesUnchanged(): void {
    $inner = $this->createMock(ClientRepositoryInterface::class);
    $inner->expects($this->once())->method('validateClient')->willReturn(FALSE);

    $repository = $this->repository($inner, NULL);
    $this->assertFalse($repository->validateClient('unknown', 'secret', 'client_credentials'));
  }

}
