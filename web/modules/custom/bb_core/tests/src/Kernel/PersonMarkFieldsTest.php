<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\file\Entity\File;
use Drupal\image\Entity\ImageStyle;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A user's person mark is computed on the account, in one place.
 *
 * The `compact` view mode and every person cell read these fields, so an
 * uploaded picture shows wherever the person does.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class PersonMarkFieldsTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'file', 'image', 'field', 'options', 'entity',
    'state_machine', 'og', 'link', 'text', 'filter', 'markdown_easy', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('file');
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['system', 'user', 'field']);
    $sync = new FileStorage(dirname($this->root) . '/config/sync');
    foreach (['field.storage.user.user_picture', 'field.field.user.user.user_picture'] as $name) {
      $data = $sync->read($name);
      self::assertIsArray($data);
      str_starts_with($name, 'field.storage.') ? FieldStorageConfig::create($data)->save() : FieldConfig::create($data)->save();
    }
    // The shipped style needs the crop module; only its URL matters here.
    ImageStyle::create(['name' => 'avatar', 'label' => 'Avatar'])->save();
    // Uid 1 is a superuser; consume it.
    $this->createUser();
  }

  /**
   * An account with a picture gets the avatar style URL.
   */
  public function testPictureComesFromTheAccount(): void {
    $ada = $this->createUser([], 'Ada Lovelace');
    self::assertInstanceOf(UserInterface::class, $ada);
    $uri = 'public://ada.png';
    file_put_contents($uri, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='));
    $file = File::create(['uri' => $uri, 'uid' => $ada->id()]);
    $file->setPermanent();
    $file->save();
    $ada->set('user_picture', $file->id())->save();

    self::assertStringContainsString('/styles/avatar/public/ada.png', (string) $ada->get('person_picture')->value);
    self::assertSame('AL', $ada->get('person_initials')->value);
    self::assertContains($ada->get('person_color')->value, ['running', 'attention', 'unassigned', 'lease', 'offline']);
    self::assertSame($ada->get('person_picture')->value, $this->cell($ada)['picture'], 'the person cell carries the picture');
  }

  /**
   * An account without a picture gets initials only.
   */
  public function testNoPictureLeavesInitials(): void {
    $bob = $this->createUser([], 'bob');
    self::assertInstanceOf(UserInterface::class, $bob);

    self::assertSame('', (string) $bob->get('person_picture')->value);
    self::assertSame('B', $bob->get('person_initials')->value);
    self::assertSame(['display_name' => 'bob', 'initials' => 'B', 'color' => $bob->get('person_color')->value], $this->cell($bob), 'initials only');
  }

  /**
   * The person cell every builder takes from PersonIdentityTrait.
   *
   * @return array<string, string>
   *   The cell's identity props.
   */
  private function cell(UserInterface $account): array {
    $builder = new class() {

      use PersonIdentityTrait {
        personMark as public;
      }

    };
    return $builder->personMark($account);
  }

}
