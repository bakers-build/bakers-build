<?php

declare(strict_types=1);

namespace Drupal\bb_image\Hook;

use Drupal\Core\Cache\CacheTagsInvalidatorInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Image\ImageFactory;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\crop\CropInterface;
use Drupal\file\FileInterface;
use Drupal\file\FileUsage\FileUsageInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * The one square crop an image file carries, read, checked and written.
 *
 * The bb_square_image widget stages `crop` as a plain value on an image
 * field item; the entity hooks below write it once the entity has saved, so a
 * failed validation, a Skip or an abandoned form never persists a crop.
 *
 * Geometry is `{x, y, size}`: the top-left corner and edge length of the
 * square in the original image's pixels. Crop API stores the centre, so the
 * conversion lives here and nowhere else. The crop belongs to the file's URI,
 * which is why every reference to the file — and every avatar — shares it,
 * and why only someone who may edit every entity using the file may crop it.
 */
final class SquareCropHooks {

  /**
   * The crop type every avatar image style applies.
   */
  public const string TYPE = 'bb_avatar';

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    #[Autowire(service: 'image.factory')]
    private readonly ImageFactory $imageFactory,
    private readonly CacheTagsInvalidatorInterface $cacheTagsInvalidator,
    #[Autowire(service: 'file.usage')]
    private readonly FileUsageInterface $fileUsage,
    #[Autowire(service: 'current_user')]
    private readonly AccountProxyInterface $currentUser,
  ) {}

  /**
   * Implements hook_entity_insert().
   */
  #[Hook('entity_insert')]
  public function entityInsert(EntityInterface $entity): void {
    $this->saveStaged($entity);
  }

  /**
   * Implements hook_entity_update().
   */
  #[Hook('entity_update')]
  public function entityUpdate(EntityInterface $entity): void {
    $this->saveStaged($entity);
  }

  /**
   * Writes every valid crop staged on the entity's image field items.
   */
  private function saveStaged(EntityInterface $entity): void {
    if (!$entity instanceof ContentEntityInterface) {
      return;
    }
    foreach ($entity->getFieldDefinitions() as $name => $definition) {
      if ($definition->getType() !== 'image') {
        continue;
      }
      foreach ($entity->get($name) as $item) {
        $geometry = $item->getValue()['crop'] ?? NULL;
        $file = $item->get('entity')->getValue();
        // The widget refuses invalid geometry; anything else is ignored.
        if (is_array($geometry) && $file instanceof FileInterface && $this->violation($geometry, $file) === NULL) {
          $this->save($file, $geometry);
        }
      }
    }
  }

  /**
   * The file's saved square, or NULL when it has none.
   *
   * @return array{x: int, y: int, size: int}|null
   *   The geometry.
   */
  public function find(FileInterface $file): ?array {
    $crop = $this->load($file);
    if ($crop === NULL) {
      return NULL;
    }
    $anchor = $crop->anchor();
    return ['x' => $anchor['x'], 'y' => $anchor['y'], 'size' => $crop->size()['width']];
  }

  /**
   * Why the geometry cannot crop the file, or NULL when it can.
   */
  public function violation(mixed $geometry, FileInterface $file): ?TranslatableMarkup {
    if (!is_array($geometry) || array_filter(['x', 'y', 'size'], fn (string $key): bool => !$this->isFiniteNumber($geometry[$key] ?? NULL))) {
      return new TranslatableMarkup('The crop must be a square.');
    }
    [$x, $y, $size] = $this->pixels($geometry);
    $image = $this->imageFactory->get($file->getFileUri());
    if (!$image->isValid()) {
      return new TranslatableMarkup('Only an image can be cropped.');
    }
    if ($size < 1 || $x < 0 || $y < 0 || $x + $size > $image->getWidth() || $y + $size > $image->getHeight()) {
      return new TranslatableMarkup('The crop must lie inside the image.');
    }
    if (!$this->mayEditEveryUse($file)) {
      return new TranslatableMarkup('You may not crop this image.');
    }
    return NULL;
  }

  /**
   * Whether the current user may edit every entity the file is used by.
   *
   * Core accepts a submitted reference to any downloadable file, so the file
   * in a form proves nothing; editing everything it frames does. A new upload
   * has no usage yet and is the uploader's own.
   */
  private function mayEditEveryUse(FileInterface $file): bool {
    foreach ($this->fileUsage->listUsage($file) as $types) {
      foreach ($types as $type => $ids) {
        foreach ($this->entityTypeManager->getStorage($type)->loadMultiple(array_keys($ids)) as $using) {
          if (!$using->access('update', $this->currentUser)) {
            return FALSE;
          }
        }
      }
    }
    return TRUE;
  }

  /**
   * Writes the square for the file; the geometry has passed violation().
   *
   * @param \Drupal\file\FileInterface $file
   *   The cropped file.
   * @param array<string, mixed> $geometry
   *   The validated geometry.
   */
  private function save(FileInterface $file, array $geometry): void {
    [$x, $y, $size] = $this->pixels($geometry);
    $crop = $this->load($file) ?? $this->entityTypeManager->getStorage('crop')->create([
      'type' => self::TYPE,
      'entity_type' => 'file',
      'entity_id' => $file->id(),
      'uri' => $file->getFileUri(),
    ]);
    assert($crop instanceof CropInterface);
    // Crop API's anchor() is (int) (centre - size / 2); rounding the centre up
    // makes that land back on $x for odd sizes too.
    $crop->setPosition($x + intdiv($size + 1, 2), $y + intdiv($size + 1, 2));
    $crop->setSize($size, $size);
    // Crop API flushes the derivatives; rendered avatars carry the file's tags.
    $crop->save();
    $this->cacheTagsInvalidator->invalidateTags($file->getCacheTags());
  }

  /**
   * Whether a submitted coordinate is a finite number.
   */
  private function isFiniteNumber(mixed $value): bool {
    return is_numeric($value) && is_finite((float) $value);
  }

  /**
   * Whole pixels of a numeric geometry.
   *
   * @param array<string, mixed> $geometry
   *   The geometry, already checked to be numeric.
   *
   * @return array{int, int, int}
   *   X, Y and size.
   */
  private function pixels(array $geometry): array {
    return array_map(static fn (string $key): int => (int) round((float) $geometry[$key]), ['x', 'y', 'size']);
  }

  /**
   * The crop entity for the file's URI.
   */
  private function load(FileInterface $file): ?CropInterface {
    $crops = $this->entityTypeManager->getStorage('crop')->loadByProperties([
      'uri' => $file->getFileUri(),
      'type' => self::TYPE,
    ]);
    $crop = reset($crops);
    return $crop instanceof CropInterface ? $crop : NULL;
  }

}
