<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * Ensures an image field references a file the image toolkit can read.
 *
 * Core checks this only in the image widget; the JSON:API file upload applies
 * the field settings alone, so a text file named `.png` would be attached.
 * Applied to the field, it runs on every write path.
 */
#[Constraint(
  id: 'BbImageFileIsImage',
  label: new TranslatableMarkup('Referenced file is a valid image'),
)]
final class BbImageFileIsImageConstraint extends SymfonyConstraint {

}
