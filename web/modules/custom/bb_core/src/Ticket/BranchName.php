<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * The rules a ticket's git branch name is derived from.
 *
 * The entity freezes the name in `preSave()`; naming itself (default,
 * repo convention, git-safe sanitiser, identifier-preserving length cap)
 * lives here. Static because it runs inside `preSave()` with no injectable
 * instance.
 *
 * @see \Drupal\bb_core\Entity\BbTicket::preSave()
 */
final class BranchName {

  /**
   * The default branch-name convention used when no repo overrides it.
   *
   * A standard Drupal-token template — the single source of the historical
   * `feat/<identifier>-<title>` shape, now expressed as an overridable default
   * rather than a hard-coded code path. A repo `branch_convention` (see
   * ::convention()) replaces it when set.
   */
  public const DEFAULT_CONVENTION = 'feat/[bb_ticket:identifier]-[bb_ticket:title]';

  /**
   * A branch name a conductor may pass to git.
   *
   * `git check-ref-format` rules on [A-Za-z0-9._/-], and no leading '-' that
   * git reads as an option.
   */
  public const PATTERN = '#^(?![-.])(?!.*(\\.\\.|//|/\\.|\\.lock(/|\\z)))[A-Za-z0-9._/-]+(?<![/.])\\z#';

  /**
   * The maximum branch-name length; longer names have their title truncated.
   */
  public const MAX_LENGTH = 30;

  /**
   * Derives the branch name for a ticket, or '' when it cannot have one.
   *
   * A deployment ticket always gets `release/<identifier>`. Every other ticket
   * resolves the repo convention, or the overridable default when no repo
   * sets one. Token-resolve, sanitise, then cap — the imperative
   * post-processing (30-char cap, identifier never truncated) runs after token
   * resolution for every convention alike.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket to derive from.
   *
   * @return string
   *   The branch name, or '' when the ticket has no identifier to build one
   *   from.
   */
  public static function derive(BbTicketInterface $ticket): string {
    // The identifier is the stable, unique ref; without it there is no branch.
    $identifier = self::sanitize((string) $ticket->get('identifier')->value);
    if ($identifier === '') {
      return '';
    }
    // A deployment's ticket branch is its release branch, whatever the
    // project convention says.
    if (mb_strtolower((string) $ticket->get('ticket_type')->entity?->label()) === 'deployment') {
      return self::cap(self::sanitize('release/' . $identifier), $identifier);
    }
    $convention = self::convention($ticket) ?: self::DEFAULT_CONVENTION;
    $raw = (string) \Drupal::token()->replace(
      $convention,
      ['bb_ticket' => $ticket],
      ['clear' => TRUE],
    );
    return self::cap(self::sanitize($raw), $identifier);
  }

  /**
   * Returns the project's repository's non-empty branch_convention, or ''.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket whose project is consulted.
   *
   * @return string
   *   The convention template, or '' when no repository declares one.
   */
  public static function convention(BbTicketInterface $ticket): string {
    if ($ticket->get('project_id')->isEmpty()) {
      return '';
    }
    $project = $ticket->get('project_id')->entity;
    if (!$project instanceof ContentEntityInterface) {
      return '';
    }
    $repo = $project->get('repository')->first();
    return $repo === NULL ? '' : (string) $repo->get('branch_convention')->getValue();
  }

  /**
   * Sanitises a resolved convention into a git-safe branch ref.
   *
   * Lower-cases, collapses runs of characters outside [a-z0-9._/-] to '-',
   * preserves '/' as the path separator, and drops what git refuses, so the
   * result always matches ::PATTERN or is empty.
   *
   * @param string $value
   *   The raw, token-resolved value.
   *
   * @return string
   *   The sanitised value.
   */
  public static function sanitize(string $value): string {
    $v = mb_strtolower(trim($value));
    $v = (string) preg_replace('#[^a-z0-9._/-]+#', '-', $v);
    // Collapse dashes hugging a slash and repeated slashes.
    $v = (string) preg_replace('#-*/+-*#', '/', $v);
    $v = (string) preg_replace('#-{2,}#', '-', $v);
    // What git refuses: "..", a segment ending in ".lock" or starting with
    // "." or "-", and a trailing ".".
    $v = (string) preg_replace('#\.{2,}#', '.', $v);
    $v = (string) preg_replace('#\.lock(?=/|$)#', '', $v);
    $v = (string) preg_replace('#(^|/)[.-]+#', '$1', $v);
    return trim($v, '-/.');
  }

  /**
   * Caps a sanitised branch at the max length without cutting the identifier.
   *
   * The imperative post-processing shared by every convention: the identifier
   * must stay a stable, unique ref, so everything up to and including it is
   * protected and only the trailing (title) portion is truncated to fit. When
   * `<prefix><identifier>` already fills the budget the title is dropped
   * entirely, and an over-budget identifier is still returned untruncated.
   *
   * @param string $branch
   *   The already token-resolved and sanitised branch.
   * @param string $identifier
   *   The sanitised ticket identifier that must not be truncated.
   *
   * @return string
   *   The branch, capped and with trailing separators trimmed.
   */
  public static function cap(string $branch, string $identifier): string {
    if (mb_strlen($branch) <= self::MAX_LENGTH) {
      return $branch;
    }
    // The protected span reaches to the end of the identifier's first
    // occurrence; if the identifier is absent nothing may be truncated.
    $pos = $identifier === '' ? FALSE : mb_strpos($branch, $identifier);
    if ($pos === FALSE) {
      return $branch;
    }
    $protected = mb_substr($branch, 0, $pos + mb_strlen($identifier));
    if (mb_strlen($protected) >= self::MAX_LENGTH) {
      return $protected;
    }
    return rtrim(mb_substr($branch, 0, self::MAX_LENGTH), '-/._');
  }

}
