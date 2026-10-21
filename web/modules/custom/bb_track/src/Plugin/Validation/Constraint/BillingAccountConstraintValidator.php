<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\Validation\Constraint;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_track\AccountValidation;
use Drupal\bb_track\Entity\Account;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Reports blank names, default archiving and foreign terms as violations.
 */
final class BillingAccountConstraintValidator extends ConstraintValidator implements ContainerInjectionInterface {

  /**
   * Constructs the validator.
   */
  public function __construct(private EntityTypeManagerInterface $entities) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('entity_type.manager'));
  }

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    assert($constraint instanceof BillingAccountConstraint);
    if (!$value instanceof Account) {
      return;
    }
    if (trim((string) $value->label()) === '') {
      $this->context->buildViolation($constraint->nameMessage)->atPath('name')->addViolation();
    }
    $original = $value->isNew() ? NULL : $this->entities->getStorage('bb_track_account')->loadUnchanged($value->id());
    if ($original instanceof Account && $value->get('is_default')->value && !$value->get('active')->value && $original->get('active')->value) {
      $this->context->buildViolation($constraint->defaultMessage)->atPath('active')->addViolation();
    }
    $this->termViolations($value, $original instanceof Account ? $original : NULL);
  }

  /**
   * Reports each term that does not fit the account's type.
   *
   * JSON:API PATCH drops violations of fields it did not write, so one on an
   * unchanged field (another field changed the type) is entity-wide.
   */
  private function termViolations(Account $billing_account, ?Account $original): void {
    $terms = AccountValidation::termsOf($billing_account);
    $stored = $original ? AccountValidation::termsOf($original) : [];
    foreach (AccountValidation::terms($terms) as $field => $message) {
      $violation = $this->context->buildViolation($message);
      if (!array_key_exists($field, $stored) || $stored[$field] !== $terms[$field]) {
        $violation->atPath($field);
      }
      $violation->addViolation();
    }
  }

}
