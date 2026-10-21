<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_image\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\entity_test\Entity\EntityTest;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\file\Entity\File;
use Drupal\file\FileInterface;
use Drupal\bb_image\Hook\SquareCropHooks;
use Drupal\image\Entity\ImageStyle;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A square crop staged on an image field item frames every avatar of its file.
 *
 * The crop is written by SquareCropHooks once the entity has saved.
 *
 * The image style and crop type are the shipped recipe config, so the test
 * renders exactly what a site renders. The source is 300×100: red, green and
 * blue thirds, so the colour at the centre of the 80×80 avatar names the
 * third the crop selected.
 */
#[Group('bb_image')]
#[RunTestsInSeparateProcesses]
final class SquareImageCropTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   */
  protected bool $usesSuperUserAccessPolicy = FALSE;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'field', 'file', 'image', 'crop', 'entity_test', 'bb_image',
  ];

  /**
   * The crop hooks under test.
   */
  private SquareCropHooks $crops;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('file');
    $this->installEntitySchema('crop');
    $this->installEntitySchema('entity_test');
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['system', 'image', 'crop']);
    $recipe = $this->root . '/../recipes/bakers/config/';
    $this->container->get('entity_type.manager')->getStorage('crop_type')
      ->create(Yaml::decode((string) file_get_contents($recipe . 'crop.type.bb_avatar.yml')))->save();
    $this->container->get('entity_type.manager')->getStorage('image_style')
      ->create(Yaml::decode((string) file_get_contents($recipe . 'image.style.avatar.yml')))->save();
    FieldStorageConfig::create([
      'field_name' => 'image',
      'entity_type' => 'entity_test',
      'type' => 'image',
    ])->save();
    FieldConfig::create([
      'field_name' => 'image',
      'entity_type' => 'entity_test',
      'bundle' => 'entity_test',
    ])->save();
    // The current user may edit every test entity and so crop its images.
    $this->setUpCurrentUser([], ['administer entity_test content']);
    $crops = $this->container->get(SquareCropHooks::class);
    assert($crops instanceof SquareCropHooks);
    $this->crops = $crops;
  }

  /**
   * The chosen square frames the avatar; a second crop of the file reframes it.
   */
  public function testCropFramesTheAvatarAndCanBeChanged(): void {
    $file = $this->threeThirds();
    $source = hash_file('sha256', $file->getFileUri());
    $entity = EntityTest::create([
      'image' => ['target_id' => $file->id(), 'alt' => 'x', 'crop' => ['x' => 0, 'y' => 0, 'size' => 100]],
    ]);
    $entity->save();
    self::assertSame([255, 0, 0], $this->avatarCentre($file), 'The left square is red.');

    $entity = EntityTest::load($entity->id());
    $entity->set('image', ['target_id' => $file->id(), 'alt' => 'x', 'crop' => ['x' => 200, 'y' => 0, 'size' => 100]]);
    $entity->save();
    self::assertSame([0, 0, 255], $this->avatarCentre($file), 'The right square is blue.');
    self::assertSame($source, hash_file('sha256', $file->getFileUri()), 'The original is never rewritten.');
  }

  /**
   * The file's saved crop is read back as the same square, odd size included.
   */
  public function testSavedCropIsReadBack(): void {
    $file = $this->threeThirds();
    EntityTest::create([
      'image' => ['target_id' => $file->id(), 'alt' => 'x', 'crop' => ['x' => 101, 'y' => 0, 'size' => 99]],
    ])->save();
    self::assertSame(['x' => 101, 'y' => 0, 'size' => 99], $this->crops->find($file));
  }

  /**
   * Without a crop the avatar keeps its centred square.
   */
  public function testNoCropKeepsTheCentredSquare(): void {
    $file = $this->threeThirds();
    EntityTest::create(['image' => ['target_id' => $file->id(), 'alt' => 'x']])->save();
    self::assertSame([0, 255, 0], $this->avatarCentre($file));
  }

  /**
   * Geometry that leaves the image or is no square is refused and not saved.
   *
   * @param array<string, mixed> $crop
   *   The submitted crop.
   */
  #[DataProvider('invalidCrops')]
  public function testInvalidCropIsRefused(array $crop): void {
    $file = $this->threeThirds();
    self::assertNotNull($this->crops->violation($crop, $file));
    EntityTest::create(['image' => ['target_id' => $file->id(), 'alt' => 'x', 'crop' => $crop]])->save();
    self::assertNull($this->crops->find($file));
    self::assertSame([0, 255, 0], $this->avatarCentre($file), 'The centred square stays.');
  }

  /**
   * Nobody reframes a file used by an entity they may not edit.
   *
   * Core accepts a submitted reference to any file the submitter can
   * download, so another person's picture can arrive in my form; its crop
   * must not change, neither on that save nor on a later one.
   */
  public function testAnotherOwnersFileIsNotCropped(): void {
    $cropped = $this->threeThirds();
    $plain = $this->threeThirds();
    EntityTest::create([
      'image' => ['target_id' => $cropped->id(), 'alt' => 'x', 'crop' => ['x' => 0, 'y' => 0, 'size' => 100]],
    ])->save();
    EntityTest::create(['image' => ['target_id' => $plain->id(), 'alt' => 'x']])->save();

    // Someone who may edit their own test entities, but none of the owner's.
    $outsider = $this->createUser(['edit own entity_test content']);
    assert($outsider instanceof UserInterface);
    $this->setCurrentUser($outsider);
    $right = ['x' => 200, 'y' => 0, 'size' => 100];
    // Their own upload on their own entity is theirs to crop, so only the
    // owner's use of a file can be what refuses the forged crops below.
    $own = $this->threeThirds();
    EntityTest::create([
      'user_id' => $outsider->id(),
      'image' => ['target_id' => $own->id(), 'alt' => 'x', 'crop' => $right],
    ])->save();
    self::assertSame($right, $this->crops->find($own));
    self::assertNotNull($this->crops->violation($right, $cropped));
    foreach ([$cropped, $plain] as $file) {
      $forged = EntityTest::create([
        'user_id' => $outsider->id(),
        'image' => ['target_id' => $file->id(), 'alt' => 'x', 'crop' => $right],
      ]);
      $forged->save();
      // Referenced by my own entity since the first save, it is still not mine.
      $forged->set('image', ['target_id' => $file->id(), 'alt' => 'x', 'crop' => $right]);
      $forged->save();
    }
    self::assertSame(['x' => 0, 'y' => 0, 'size' => 100], $this->crops->find($cropped));
    self::assertSame([255, 0, 0], $this->avatarCentre($cropped), 'The owner\'s framing stays.');
    self::assertNull($this->crops->find($plain));
  }

  /**
   * A crop chosen for the replaced image does not fit its smaller successor.
   */
  public function testCropOfTheReplacedImageIsRefused(): void {
    $entity = EntityTest::create(['image' => ['target_id' => $this->threeThirds()->id(), 'alt' => 'x']]);
    $entity->save();
    $square = $this->threeThirds(100);
    $entity->set('image', ['target_id' => $square->id(), 'alt' => 'x', 'crop' => ['x' => 200, 'y' => 0, 'size' => 100]]);
    $entity->save();
    self::assertNull($this->crops->find($square));
  }

  /**
   * Removing one reference to a shared file keeps the other's crop.
   */
  public function testRemovingOneReferenceKeepsTheSharedCrop(): void {
    $file = $this->threeThirds();
    EntityTest::create([
      'image' => ['target_id' => $file->id(), 'alt' => 'x', 'crop' => ['x' => 0, 'y' => 0, 'size' => 100]],
    ])->save();
    $second = EntityTest::create(['image' => ['target_id' => $file->id(), 'alt' => 'x']]);
    $second->save();
    $second->set('image', [])->save();
    self::assertSame(['x' => 0, 'y' => 0, 'size' => 100], $this->crops->find($file));
    self::assertSame([255, 0, 0], $this->avatarCentre($file));
  }

  /**
   * Out-of-bounds, empty, negative and non-numeric crops of a 300×100 image.
   *
   * @return array<string, array{array<string, mixed>}>
   *   Named cases.
   */
  public static function invalidCrops(): array {
    return [
      'past the right edge' => [['x' => 201, 'y' => 0, 'size' => 100]],
      'taller than the image' => [['x' => 0, 'y' => 0, 'size' => 101]],
      'zero size' => [['x' => 0, 'y' => 0, 'size' => 0]],
      'negative position' => [['x' => -1, 'y' => 0, 'size' => 50]],
      'not a number' => [['x' => 'left', 'y' => 0, 'size' => 50]],
      'infinite' => [['x' => 0, 'y' => 0, 'size' => INF]],
      'missing size' => [['x' => 0, 'y' => 0]],
    ];
  }

  /**
   * A permanent PNG, 100 high, of red, green and blue thirds of its width.
   *
   * @param int<3, max> $width
   *   The width in pixels.
   */
  private function threeThirds(int $width = 300): FileInterface {
    $gd = imagecreatetruecolor($width, 100);
    foreach ([[255, 0, 0], [0, 255, 0], [0, 0, 255]] as $third => [$r, $g, $b]) {
      imagefilledrectangle($gd, intdiv($third * $width, 3), 0, intdiv(($third + 1) * $width, 3) - 1, 99, (int) imagecolorallocate($gd, $r, $g, $b));
    }
    $uri = 'public://thirds-' . $this->randomMachineName() . '.png';
    imagepng($gd, $this->container->get('file_system')->realpath('public://') . '/' . basename($uri));
    $file = File::create(['uri' => $uri, 'status' => 1]);
    $file->save();
    return $file;
  }

  /**
   * RGB at the centre of the file's freshly generated avatar.
   *
   * @return array{int, int, int}
   *   Red, green, blue.
   */
  private function avatarCentre(FileInterface $file): array {
    $style = ImageStyle::load('avatar');
    $derivative = $style->buildUri($file->getFileUri());
    self::assertFileDoesNotExist($derivative, 'No stale derivative survives a crop change.');
    self::assertTrue($style->createDerivative($file->getFileUri(), $derivative));
    $gd = imagecreatefrompng((string) $this->container->get('file_system')->realpath($derivative));
    self::assertInstanceOf(\GdImage::class, $gd);
    self::assertSame([80, 80], [imagesx($gd), imagesy($gd)]);
    $rgb = imagecolorat($gd, 40, 40);
    return [($rgb >> 16) & 0xFF, ($rgb >> 8) & 0xFF, $rgb & 0xFF];
  }

}
