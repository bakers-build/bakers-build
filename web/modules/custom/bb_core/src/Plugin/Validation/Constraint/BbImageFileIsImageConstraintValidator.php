<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\file\FileInterface;
use Drupal\file\Validation\FileValidatorInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Runs core's `FileIsImage` file validator on each newly referenced file.
 *
 * A file the saved entity already references is not re-read, so an image
 * missing on disk does not block every later edit of its entity.
 */
final class BbImageFileIsImageConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  public function __construct(
    private readonly FileValidatorInterface $fileValidator,
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('file.validator'), $container->get('entity_type.manager'));
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    if (!$value instanceof FieldItemListInterface) {
      return;
    }
    $saved = [];
    $entity = $value->getEntity();
    if (!$entity->isNew()) {
      $original = $this->entityTypeManager->getStorage($entity->getEntityTypeId())->loadUnchanged($entity->id());
      $saved = $original instanceof FieldableEntityInterface ? array_column($original->get($value->getName())->getValue(), 'target_id') : [];
    }
    foreach ($value as $delta => $item) {
      $file = $item->get('entity')->getValue();
      if (!$file instanceof FileInterface || in_array($file->id(), $saved, FALSE)) {
        continue;
      }
      foreach ($this->fileValidator->validate($file, ['FileIsImage' => []]) as $violation) {
        $this->context->buildViolation((string) $violation->getMessage())
          ->atPath((string) $delta . '.target_id')
          ->addViolation();
      }
    }
  }

}
