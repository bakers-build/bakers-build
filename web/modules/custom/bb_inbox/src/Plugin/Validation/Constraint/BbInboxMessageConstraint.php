<?php

declare(strict_types=1);

namespace Drupal\bb_inbox\Plugin\Validation\Constraint;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Validation\Attribute\Constraint;
use Symfony\Component\Validator\Constraint as SymfonyConstraint;

/**
 * A message has a responsible handler, a conductor and a forward status.
 */
#[Constraint(
  id: 'BbInboxMessage',
  label: new TranslatableMarkup('bakers.build inbox message', [], ['context' => 'Validation']),
  type: ['entity:bb_inbox_message'],
)]
final class BbInboxMessageConstraint extends SymfonyConstraint {}
