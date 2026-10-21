<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit\Ticket;

use Drupal\bb_core\Ticket\OriginReference;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Covers the origin-reference grammar.
 */
#[CoversClass(OriginReference::class)]
final class OriginReferenceTest extends TestCase {

  /**
   * An issue URL yields the lowercased repository path and the issue number.
   */
  #[DataProvider('issueUrls')]
  public function testFromUrlReadsPathAndNumber(string $url, string $expected): void {
    $reference = OriginReference::fromUrl($url);
    self::assertNotNull($reference);
    self::assertSame($expected, $reference->key());
  }

  /**
   * Every spelling of one issue collapses to one key.
   */
  public static function issueUrls(): array {
    return [
      'canonical' => ['https://git.key-tec.de/bakers-build/bakers-build/-/issues/19', 'bakers-build/bakers-build#19'],
      'without dash segment' => ['https://git.key-tec.de/bakers-build/bakers-build/issues/19', 'bakers-build/bakers-build#19'],
      'http' => ['http://git.key-tec.de/bakers-build/bakers-build/-/issues/19', 'bakers-build/bakers-build#19'],
      'trailing slash' => ['https://git.key-tec.de/bakers-build/bakers-build/-/issues/19/', 'bakers-build/bakers-build#19'],
      'mixed case path' => ['https://git.key-tec.de/Keytec/bakers.build/-/issues/19', 'bakers-build/bakers-build#19'],
      'nested group' => ['https://git.key-tec.de/a/b/c/-/issues/7', 'a/b/c#7'],
    ];
  }

  /**
   * A URL that names no issue produces no reference.
   */
  #[DataProvider('nonIssueUrls')]
  public function testFromUrlRejectsNonIssues(string $url): void {
    self::assertNull(OriginReference::fromUrl($url));
  }

  /**
   * Job URLs and bare project URLs are real origins without an issue number.
   */
  public static function nonIssueUrls(): array {
    return [
      'job' => ['https://git.key-tec.de/leando/bibb-community/-/jobs/195759'],
      'project root' => ['https://git.key-tec.de/bakers-build/bakers-build'],
      'merge request' => ['https://git.key-tec.de/bakers-build/bakers-build/-/merge_requests/12'],
      'empty' => [''],
      'not a url' => ['bakers-build/bakers-build#19'],
    ];
  }

  /**
   * A short reference splits into its optional alias and its number.
   */
  #[DataProvider('shortReferences')]
  public function testParseShortReference(string $input, ?array $expected): void {
    self::assertSame($expected, OriginReference::parseShortReference($input));
  }

  /**
   * The accepted short forms, and the forms that are not short references.
   */
  public static function shortReferences(): array {
    return [
      'bare hash' => ['#19', ['alias' => NULL, 'number' => 19]],
      'alias' => ['bakers#19', ['alias' => 'bakers', 'number' => 19]],
      'alias prefix' => ['sym#1234', ['alias' => 'sym', 'number' => 1234]],
      'uppercase alias' => ['bakers.build#19', ['alias' => 'bakers', 'number' => 19]],
      'surrounding space' => ['  #19  ', ['alias' => NULL, 'number' => 19]],
      'identifier is not one' => ['BB-295', NULL],
      'bare number is not one' => ['19', NULL],
      'no number' => ['bakers#', NULL],
      'zero rejected' => ['#0', NULL],
      'free text' => ['theme tokens', NULL],
    ];
  }

  /**
   * A repository URL yields its path and its alias.
   */
  #[DataProvider('repositoryUrls')]
  public function testRepositoryUrlParts(string $url, ?string $path, ?string $alias): void {
    self::assertSame($path, OriginReference::pathOf($url));
    self::assertSame($alias, OriginReference::aliasOf($url));
  }

  /**
   * The live project stores an ssh URL; https and bare scp forms also occur.
   */
  public static function repositoryUrls(): array {
    return [
      'ssh with .git' => ['ssh://git@git.key-tec.de/bakers-build/bakers-build.git', 'bakers-build/bakers-build', 'bakers'],
      'https' => ['https://git.key-tec.de/bakers-build/bakers-build', 'bakers-build/bakers-build', 'bakers'],
      'scp shorthand' => ['git@git.key-tec.de:bakers-build/bakers-build.git', 'bakers-build/bakers-build', 'bakers'],
      'nested group' => ['https://git.key-tec.de/a/b/c.git', 'a/b/c', 'c'],
      'empty' => ['', NULL, NULL],
    ];
  }

}
