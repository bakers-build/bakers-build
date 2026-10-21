<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_activity\Entity\NotificationSettingInterface;
use Drupal\bb_activity\NotificationSettings;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Every account has exactly one settings row, from install to deletion.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class NotificationSettingTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image', 'serialization', 'jsonapi',
    'bb_core',
  ];

  /**
   * Accounts that existed before the module was installed.
   *
   * @var list<\Drupal\user\UserInterface>
   */
  private array $existing = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    // Deleting an account clears its user data and runs OG lookups.
    $this->installEntitySchema('og_membership');
    $this->installSchema('user', ['users_data']);
    $this->installConfig(['system', 'user']);
    // Uid 1 bypasses access checks, so it is never an actor below.
    $this->createUser([], 'root');
    $early_a = $this->createUser([], 'early-a');
    $early_b = $this->createUser([], 'early-b');
    self::assertInstanceOf(UserInterface::class, $early_a);
    self::assertInstanceOf(UserInterface::class, $early_b);
    $this->existing = [$early_a, $early_b];
    // Installed, not listed in $modules, so hook_install() runs as on a site.
    $this->container->get('module_installer')->install(['bb_activity']);
  }

  /**
   * Install writes no row: an account has one only once it chose.
   */
  public function testInstallWritesNoRows(): void {
    self::assertSame([], $this->rows());
  }

  /**
   * Creating an account writes no row either.
   */
  public function testCreatingAnAccountWritesNoRow(): void {
    $account = $this->createUser([], 'later');
    self::assertInstanceOf(UserInterface::class, $account);
    self::assertCount(0, $this->rowsOf($account));
  }

  /**
   * The database itself refuses a second row for one account.
   */
  public function testTheDatabaseRejectsSecondRowForOneAccount(): void {
    $settings = $this->container->get(NotificationSettings::class);
    $settings->ensure((int) $this->existing[0]->id());
    $this->expectException(EntityStorageException::class);
    $settings->create((int) $this->existing[0]->id())->save();
  }

  /**
   * Ensuring a row twice returns the same row.
   */
  public function testEnsureIsIdempotent(): void {
    $settings = $this->container->get(NotificationSettings::class);
    $uid = (int) $this->existing[0]->id();
    self::assertSame($settings->ensure($uid)->id(), $settings->ensure($uid)->id());
    self::assertCount(1, $this->rowsOf($this->existing[0]));
  }

  /**
   * The row holds one data field, plain strings, with no logic behind it.
   */
  public function testTheRowHasOneDataFieldWithoutLogic(): void {
    $definitions = $this->container->get('entity_field.manager')->getBaseFieldDefinitions('bb_notification_setting');
    self::assertSame(['id', 'uuid', 'user_id', 'messages'], array_keys($definitions));
    self::assertSame('string', $definitions['messages']->getType());
    foreach ($definitions as $name => $definition) {
      self::assertInstanceOf(FieldDefinitionInterface::class, $definition);
      self::assertEmpty($definition->getSetting('allowed_values_function'), "$name has no allowed values function.");
      self::assertNull($definition->getDefaultValueCallback(), "$name has no default value callback.");
    }
  }

  /**
   * Only the addressed kinds offer a mail by default; nothing is on.
   */
  public function testOnlyTheAddressedKindsOfferMailByDefault(): void {
    $kinds = $this->container->get('plugin.manager.bb_activity_kind');
    self::assertSame(
      ['assigned', 'review_requested', 'review_completed'],
      array_keys($kinds->mailOffers()),
    );
    self::assertSame([], $kinds->mailDefaults());
  }

  /**
   * A kind without mail offers no checkbox at all.
   */
  public function testKindWithoutMailOffersNoCheckbox(): void {
    $offers = $this->container->get('plugin.manager.bb_activity_kind')->mailOffers();
    foreach (['created', 'status_changed', 'claimed', 'run_ended'] as $kind) {
      self::assertArrayNotHasKey($kind, $offers);
    }
  }

  /**
   * A kind's default reaches every account that has not chosen yet.
   *
   * An account that saved its choices keeps them: the default is not added.
   */
  public function testDefaultReachesAccountsThatHaveNotChosen(): void {
    $this->container->get('module_installer')->install(['bb_activity_test']);
    $settings = $this->container->get(NotificationSettings::class);
    self::assertArrayHasKey('test_default_on', $this->container->get('plugin.manager.bb_activity_kind')->mailOffers());
    self::assertArrayNotHasKey('bb_notification_setting', $this->container->get('entity.definition_update_manager')->getChangeSummary());
    [$undecided, $chosen] = $this->existing;
    $settings->ensure((int) $chosen->id())->set('messages', [])->save();

    $subscribers = $settings->subscribers('test_default_on');

    self::assertContains((int) $undecided->id(), $subscribers);
    self::assertNotContains((int) $chosen->id(), $subscribers);
    self::assertNotContains((int) $chosen->id(), $settings->subscribers('test_ticket_event'));
  }

  /**
   * The rows are internal: JSON:API offers no resource for them.
   */
  public function testSettingsAreNoJsonApiResource(): void {
    $type = $this->container->get('jsonapi.resource_type.repository')
      ->get('bb_notification_setting', 'bb_notification_setting');
    self::assertTrue($type === NULL || $type->isInternal());
  }

  /**
   * Only the owner or an administrator reaches a row; nobody creates one.
   */
  public function testOnlyTheOwnerOrAdministratorReachesTheRow(): void {
    [$owner, $other] = $this->existing;
    $admin = $this->createUser(['administer bakers'], 'bakers-admin');
    self::assertInstanceOf(UserInterface::class, $admin);
    $row = $this->container->get(NotificationSettings::class)->ensure((int) $owner->id());
    self::assertTrue($row->access('view', $owner));
    self::assertTrue($row->access('update', $owner));
    self::assertFalse($row->access('view', $other));
    self::assertFalse($row->access('update', $other));
    self::assertTrue($row->access('update', $admin));
    self::assertFalse($row->access('delete', $owner));
    self::assertFalse($this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_notification_setting')->createAccess(NULL, $owner));
  }

  /**
   * All rows.
   *
   * @return list<\Drupal\bb_activity\Entity\NotificationSettingInterface>
   *   The rows.
   */
  private function rows(): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_notification_setting');
    $storage->resetCache();
    return array_values(array_filter(
      $storage->loadMultiple(),
      static fn ($row): bool => $row instanceof NotificationSettingInterface,
    ));
  }

  /**
   * The rows of one account.
   *
   * @return list<\Drupal\bb_activity\Entity\NotificationSettingInterface>
   *   The rows.
   */
  private function rowsOf(UserInterface $account): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_notification_setting');
    $storage->resetCache();
    return array_values(array_filter(
      $storage->loadByProperties(['user_id' => $account->id()]),
      static fn ($row): bool => $row instanceof NotificationSettingInterface,
    ));
  }

}
