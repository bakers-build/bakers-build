<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Validation\Constraint;

use Drupal\Core\TypedData\TypedDataInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates repository clone URLs (https, ssh:// and SSH shorthand).
 */
final class BbRepoUrlConstraintValidator extends ConstraintValidator {

  /**
   * Absolute http(s) URL: scheme://[user[:pass]@]host[:port]/path.
   *
   * The host is a bracketed IPv6 literal or a plain host; userinfo (token-auth
   * clone URLs like https://oauth2:TOKEN@host/repo.git) is accepted. All three
   * patterns anchor with \z, not $ — PCRE `$` also matches before a trailing
   * "\n", which would let "…\n" slip past.
   */
  private const HTTP = '#^https?://([^\s/@]+(:[^\s/@]*)?@)?(\[[0-9A-Fa-f:]+\]|[^\s/@:]+)(:\d+)?(/\S*)?\z#';

  /**
   * Explicit SSH URI: ssh://[user@]host[:port]/path (host may be IPv6).
   */
  private const SSH_URI = '#^ssh://([^\s/@]+@)?(\[[0-9A-Fa-f:]+\]|[^\s/@:]+)(:\d+)?/\S+\z#';

  /**
   * SSH scp-shorthand: [user@]host:path (no scheme).
   *
   * The path must not start with '/', else "ssh://…" would parse as host "ssh"
   * plus path "//…" and wrongly match. This shares git's own ambiguity: a bare
   * "host:8080" reads as host + path "8080", never host + port — as git does.
   */
  private const SSH_SHORTHAND = '#^([^\s/@]+@)?[^\s/@:]+:[^/\s]\S*\z#';

  /**
   * {@inheritdoc}
   */
  public function validate(mixed $value, Constraint $constraint): void {
    assert($constraint instanceof BbRepoUrlConstraint);

    if ($value instanceof TypedDataInterface) {
      $value = $value->getValue();
    }
    // Emptiness/required-ness is enforced by the property's NotNull constraint;
    // this validator only judges non-empty strings.
    if (!is_string($value) || $value === '') {
      return;
    }

    if (preg_match(self::HTTP, $value) === 1
      || preg_match(self::SSH_URI, $value) === 1
      || preg_match(self::SSH_SHORTHAND, $value) === 1) {
      return;
    }

    $this->context->addViolation($constraint->message, ['%url' => $value]);
  }

}
