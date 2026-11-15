<?php

declare(strict_types=1);

namespace Drupal\bb_core\Workspace;

use Drupal\Component\Transliteration\TransliterationInterface;

/**
 * Derives a pattern-valid workspace slug from a typed workspace name.
 *
 * The slug is never asked of the customer, and never suffixed: a taken or
 * reserved slug is `BbWorkspaceSlugConstraint`'s to refuse, so the customer
 * chooses another name instead of receiving an address they did not choose.
 * A name that transliterates to nothing falls back to a generated stem.
 */
final class WorkspaceSlugDeriver {

  /**
   * The stem used when a name derives to nothing usable.
   *
   * `workspace` is itself pattern-valid and NOT on `RESERVED`.
   */
  private const FALLBACK_STEM = 'workspace';

  /**
   * The longest slug `BbWorkspaceSlugConstraint::PATTERN` accepts.
   */
  private const MAX_LENGTH = 64;

  /**
   * Constructs the deriver.
   *
   * @param \Drupal\Component\Transliteration\TransliterationInterface $transliteration
   *   Core's own transliteration, so `Ä` becomes `ae` the same way it does
   *   everywhere else in Drupal rather than by a table of ours.
   */
  public function __construct(
    private readonly TransliterationInterface $transliteration,
  ) {}

  /**
   * Derives a pattern-valid slug from a name.
   *
   * @param string $name
   *   The workspace name as typed.
   *
   * @return string
   *   A slug matching `BbWorkspaceSlugConstraint::PATTERN`; it may be taken
   *   or reserved.
   */
  public function derive(string $name): string {
    return $this->stem($name);
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

}
