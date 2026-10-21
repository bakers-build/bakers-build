<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Onboarding\OnboardingDestination;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Whether an account still has to go through the onboarding wizard.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class OnboardingDestinationTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'ui_patterns', 'file', 'image', 'bb_core',
  ];

  /**
   * The destination rule under test.
   */
  private OnboardingDestination $destination;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['system', 'user']);
    $this->container->get('router.builder')->rebuild();

    // Uid 1 bypasses every access check, so it is never an actor here.
    $this->createUser([], 'uid1-dummy');
    $this->installOnboardingFields();

    $this->destination = $this->container->get('bb_core.onboarding_destination');
  }

  /**
   * Installs the profile fields and the completion flag from config/sync.
   *
   * They live only at the repository's top level, never under
   * `bb_core/config/**`, so `installConfig('bb_core')` cannot reach them.
   */
  private function installOnboardingFields(): void {
    $this->container->get('config.typed')->clearCachedDefinitions();
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    foreach ([
      'field_developer_title',
      'field_bb_background',
      'field_onboarding_completed',
    ] as $name) {
      $storageData = $storage->read("field.storage.user.$name");
      self::assertIsArray($storageData, "config/sync/field.storage.user.$name.yml exists.");
      FieldStorageConfig::create($storageData)->save();
      $fieldData = $storage->read("field.field.user.user.$name");
      self::assertIsArray($fieldData, "config/sync/field.field.user.user.$name.yml exists.");
      FieldConfig::create($fieldData)->save();
    }
  }

  /**
   * Completion is the stored Boolean, never optional profile fullness.
   */
  public function testIsCompleteReadsStoredFlagNotProfileFields(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    self::assertFalse($this->destination->isComplete($account));

    $account->set('field_developer_title', 'Backend engineer')->save();
    $account->set('field_bb_background', 'I ship a lot of Drupal.')->save();
    self::assertFalse($this->destination->isComplete($account));

    $account->set('field_onboarding_completed', TRUE)->save();
    self::assertTrue($this->destination->isComplete($account));

    $account->set('field_bb_background', NULL)->save();
    self::assertTrue($this->destination->isComplete($account));
  }

  /**
   * A site without the completion field treats every account as complete.
   */
  public function testIsCompleteWithoutCompletionFieldIsTrue(): void {
    FieldConfig::loadByName('user', 'user', OnboardingDestination::COMPLETION_FIELD)?->delete();
    $this->container->get('entity_field.manager')->clearCachedFieldDefinitions();
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    self::assertTrue($this->destination->isComplete($account));
  }

  /**
   * A missing user is incomplete.
   */
  public function testIsCompleteReturnsFalseForMissingUser(): void {
    $missing = $this->createMock(AccountInterface::class);
    $missing->method('id')->willReturn(999999);
    self::assertFalse($this->destination->isComplete($missing));
  }

  /**
   * The wizard URL is the dedicated onboarding route.
   */
  public function testWizardUrlUsesOnboardingRoute(): void {
    self::assertSame(
      'bb_core.onboarding',
      $this->destination->wizardUrl()->getRouteName(),
    );
  }

  /**
   * Marking complete is the only write that flips the stored flag.
   */
  public function testMarkCompleteSetsStoredFlag(): void {
    $account = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $account);
    self::assertFalse($this->destination->isComplete($account));
    $this->destination->markComplete($account);
    self::assertTrue($this->destination->isComplete($account));
  }

}
