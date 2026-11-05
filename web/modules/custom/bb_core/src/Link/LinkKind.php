<?php

declare(strict_types=1);

namespace Drupal\bb_core\Link;

/**
 * Classifies a ticket link URI into a typed kind.
 *
 * The kind is derived at save time from the URI shape (GitLab URL conventions)
 * and stored in the link item's `options.bakers.kind`. It is never authored by
 * agents or humans — handoff writes stay the plain `{uri, title}` shape.
 *
 * Pure and side-effect free.
 */
final class LinkKind {

  /**
   * The kind for a merge request.
   */
  public const MR = 'mr';

  /**
   * The kind for a CI pipeline or job.
   */
  public const CI = 'ci';

  /**
   * The kind for a branch, tree, or commit reference.
   */
  public const BRANCH = 'branch';

  /**
   * The neutral fallback kind for anything else (docs, arbitrary URLs).
   */
  public const DOC = 'doc';

  /**
   * The kind for a test report artifact (e.g. the Playwright BDD HTML report).
   */
  public const REPORT = 'report';

  /**
   * The kind for a designbook / design artifact.
   */
  public const DESIGN = 'design';

  /**
   * The kind for a testable page under a worktree ddev baseURL.
   */
  public const DDEV = 'ddev';

  /**
   * The kind for a chat thread permalink (a Slack thread).
   */
  public const CHAT = 'chat';

  /**
   * All valid kinds, for reuse by the formatter.
   */
  public const KINDS = [self::MR, self::CI, self::BRANCH, self::DOC, self::REPORT, self::DESIGN, self::DDEV, self::CHAT];

  /**
   * Derives the kind from a link URI.
   *
   * @param string $uri
   *   The link URI.
   *
   * @return string
   *   One of self::KINDS. Unmatched URIs classify as self::DOC.
   */
  public static function fromUri(string $uri): string {
    return match (TRUE) {
      str_contains($uri, '/-/merge_requests/') => self::MR,
      // Report before CI: a report artifact URL also contains '/-/jobs/'.
      str_contains($uri, '/artifacts/'), str_contains($uri, 'playwright-report') => self::REPORT,
      str_contains($uri, 'designbook') => self::DESIGN,
      str_contains($uri, '/-/pipelines/'), str_contains($uri, '/-/jobs/') => self::CI,
      str_contains($uri, '/-/tree/'),
      str_contains($uri, '/-/commits/'),
      str_contains($uri, '/-/branches') => self::BRANCH,
      // A Slack thread permalink; other Slack pages stay doc.
      str_contains($uri, '.slack.com/archives/') => self::CHAT,
      // Least-specific host match, placed last before the fallback: any page
      // under a worktree ddev baseURL (a testable surface). Deliberately after
      // the GitLab shape arms so a hypothetical ddev-hosted MR/pipeline/branch
      // URL still classifies by its more specific '/-/…' path shape.
      str_contains($uri, '.ddev.site') => self::DDEV,
      default => self::DOC,
    };
  }

}
