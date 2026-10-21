<?php

declare(strict_types=1);

namespace Drupal\bb_core\Workspace;

use Drupal\Component\Transliteration\TransliterationInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Plugin\Validation\Constraint\BbWorkspaceSlugConstraint;

/**
 * Derives a usable workspace slug from a typed workspace name.
 *
 * The slug is never asked of the customer. `BbWorkspaceSlugConstraint`
 * stays the authority: this class reads its `PATTERN` and `RESERVED` constants
 * and the same table rather than restating the rules. It never fails; a name
 * that transliterates to nothing falls back to a generated stem.
 */
final class WorkspaceSlugDeriver {

  /**
   * The stem used when a name derives to nothing usable.
   *
   * `workspace` is itself pattern-valid and NOT on `RESERVED`, so the fallback
   * enters the same uniquifying loop as any other stem and comes out as
   * `workspace`, `workspace-2`, … rather than needing a branch of its own.
   */
  private const FALLBACK_STEM = 'workspace';

  /**
   * The longest slug `BbWorkspaceSlugConstraint::PATTERN` accepts.
   */
  private const MAX_LENGTH = 64;

  /**
   * How many suffixes to try before giving up on a stem.
   *
   * A bound rather than `while (TRUE)`: the loop's exit depends on a database
   * query, and an unbounded loop against a failing query is a hung request
   * instead of an error. Reaching it means something is wrong that a longer
   * loop would not fix.
   */
  private const MAX_ATTEMPTS = 1000;

  /**
   * Constructs the deriver.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   Queries existing slugs for the uniqueness rule.
   * @param \Drupal\Component\Transliteration\TransliterationInterface $transliteration
   *   Core's own transliteration, so `Ä` becomes `ae` the same way it does
   *   everywhere else in Drupal rather than by a table of ours.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TransliterationInterface $transliteration,
  ) {}

  /**
   * Derives a free, pattern-valid, non-reserved slug from a name.
   *
   * @param string $name
   *   The workspace name as typed.
   *
   * @return string
   *   A slug that satisfies all three of the constraint's rules.
   */
  public function derive(string $name): string {
    $stem = $this->stem($name);
    $candidate = $stem;
    for ($attempt = 2; $attempt <= self::MAX_ATTEMPTS; $attempt++) {
      if ($this->isFree($candidate)) {
        return $candidate;
      }
      // THE SUFFIX IS MEASURED INTO THE LIMIT, not appended past it. A stem at
      // 64 characters plus `-2` is 66 and fails PATTERN, so the stem is cut
      // to make room for the suffix that is actually about to be added — which
      // also means a long name does not silently collide with its own
      // truncation forever.
      $suffix = '-' . $attempt;
      $room = self::MAX_LENGTH - strlen($suffix);
      $candidate = rtrim(substr($stem, 0, $room), '-') . $suffix;
    }
    throw new \RuntimeException(sprintf('No free workspace slug derived from "%s" after %d attempts.', $name, self::MAX_ATTEMPTS));
  }

  /**
   * Reduces a name to the longest pattern-valid stem it can yield.
   *
   * @param string $name
   *   The workspace name as typed.
   *
   * @return string
   *   A stem matching `PATTERN`, never empty.
   */
  private function stem(string $name): string {
    // TRANSLITERATED BEFORE LOWERCASING. `Ä` transliterates to `Ae` and then
    // lowercases to `ae`; lowercasing first gives `ä`, which transliterates to
    // `a` and loses the `e` a German reader expects in the URL.
    $stem = $this->transliteration->transliterate($name, 'de', '-');
    $stem = strtolower($stem);
    // Every run of non-alphanumerics becomes ONE hyphen, so `Acme  &  Co`
    // yields `acme-co` rather than `acme-----co`.
    $stem = (string) preg_replace('/[^a-z0-9]+/', '-', $stem);
    $stem = trim($stem, '-');
    $stem = substr($stem, 0, self::MAX_LENGTH);
    // Trimmed AGAIN after the cut: truncation can land on a hyphen, and
    // PATTERN forbids a trailing one.
    $stem = rtrim($stem, '-');
    return $stem === '' ? self::FALLBACK_STEM : $stem;
  }

  /**
   * Whether a candidate satisfies all three of the constraint's rules.
   *
   * @param string $candidate
   *   The slug to test.
   *
   * @return bool
   *   TRUE when the constraint would accept it.
   */
  private function isFree(string $candidate): bool {
    if (preg_match(BbWorkspaceSlugConstraint::PATTERN, $candidate) !== 1) {
      return FALSE;
    }
    // IN_ARRAY IS THE CONSTRAINT'S OWN LIST, read rather than copied. The list
    // is hand-maintained and `ReservedSlugCoverageTest` keeps it complete
    // against the live route collection, so reading it is how this class
    // inherits that guarantee instead of drifting from it.
    if (in_array($candidate, BbWorkspaceSlugConstraint::RESERVED, TRUE)) {
      return FALSE;
    }
    // `accessCheck(FALSE)`: whether a slug is taken is a property of the table,
    // not of what the acting session may view. An access-checked query would
    // hand a new customer a slug that collides with a workspace they cannot
    // see, and the save would then fail validation instead.
    $existing = $this->entityTypeManager->getStorage('bb_workspace')->getQuery()
      ->accessCheck(FALSE)
      ->condition('slug', $candidate)
      ->range(0, 1)
      ->execute();
    return $existing === [];
  }

}
