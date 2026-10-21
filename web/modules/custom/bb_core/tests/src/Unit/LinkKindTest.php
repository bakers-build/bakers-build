<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\bb_core\Link\LinkKind;
use Drupal\Tests\UnitTestCase;

/**
 * @coversDefaultClass \Drupal\bb_core\Link\LinkKind
 *
 * @group bb_core
 */
final class LinkKindTest extends UnitTestCase {

  /**
   * @covers ::fromUri
   *
   * @dataProvider provideUris
   */
  public function testFromUri(string $uri, string $expected): void {
    $this->assertSame($expected, LinkKind::fromUri($uri));
  }

  /**
   * Data provider for testFromUri().
   *
   * @return array<string, array{string, string}>
   *   URI and its expected kind.
   */
  public static function provideUris(): array {
    return [
      'merge request' => ['https://git.key-tec.de/g/p/-/merge_requests/42', LinkKind::MR],
      'pipeline' => ['https://git.key-tec.de/g/p/-/pipelines/99', LinkKind::CI],
      'job' => ['https://git.key-tec.de/g/p/-/jobs/7', LinkKind::CI],
      'tree/branch' => ['https://git.key-tec.de/g/p/-/tree/main', LinkKind::BRANCH],
      'commits' => ['https://git.key-tec.de/g/p/-/commits/main', LinkKind::BRANCH],
      'branches' => ['https://git.key-tec.de/g/p/-/branches', LinkKind::BRANCH],
      'arbitrary doc' => ['https://example.com/spec.pdf', LinkKind::DOC],
      'gitlab project root' => ['https://git.key-tec.de/g/p', LinkKind::DOC],
      'empty' => ['', LinkKind::DOC],
      // Report artifact URLs also contain '/-/jobs/'; report must win over ci.
      'bdd report artifact' => [
        'https://git.key-tec.de/g/p/-/jobs/7/artifacts/file/playwright-report/index.html',
        LinkKind::REPORT,
      ],
      'pages report' => ['https://g.pages.key-tec.de/p/playwright-report/index.html', LinkKind::REPORT],
      'designbook' => ['https://example.com/designbook/board-card', LinkKind::DESIGN],
      // A worktree ddev baseURL page (a testable surface) classifies as ddev.
      'ddev board' => ['https://bb-131.ddev.site/board', LinkKind::DDEV],
      'ddev ticket surface' => ['https://bb-131.ddev.site/admin/bakers/ticket/abc', LinkKind::DDEV],
      // The ddev arm must not steal a GitLab MR URL — the specific MR arm wins,
      // even for a (hypothetical) ddev-hosted merge request.
      'ddev-hosted merge request stays mr' => ['https://bb-131.ddev.site/g/p/-/merge_requests/42', LinkKind::MR],
    ];
  }

  /**
   * The exposed constant lists every kind fromUri() can return.
   */
  public function testKindsConstantIsComplete(): void {
    $this->assertSame(['mr', 'ci', 'branch', 'doc', 'report', 'design', 'ddev'], LinkKind::KINDS);
  }

}
