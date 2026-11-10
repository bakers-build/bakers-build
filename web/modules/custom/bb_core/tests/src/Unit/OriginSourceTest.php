<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Tests\UnitTestCase;
use Drupal\bb_core\Project\OriginSource;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Reads a ticket's Origin URL as the source it came from.
 */
#[Group('bb_core')]
final class OriginSourceTest extends UnitTestCase {

  /**
   * Each Origin URL reads as its source, or as none.
   *
   * @param string $url
   *   The Origin URL.
   * @param array{label: string, url: string}|null $expected
   *   The source, or NULL when the URL names none.
   */
  #[DataProvider('urls')]
  public function testFromUrl(string $url, ?array $expected): void {
    self::assertSame($expected, OriginSource::fromUrl($url));
  }

  /**
   * One case per provider, plus every input that must yield no source.
   *
   * @return array<string, array{string, array{label: string, url: string}|null}>
   *   Origin URL and expected source.
   */
  public static function urls(): array {
    return [
      'gitlab' => [
        'https://gitlab.example.com/keytec/gaia/-/issues/12',
        ['label' => 'GitLab - keytec/gaia', 'url' => 'https://gitlab.example.com/keytec/gaia'],
      ],
      'gitlab without separator' => [
        'https://gitlab.example.com/keytec/gaia/issues/12',
        ['label' => 'GitLab - keytec/gaia', 'url' => 'https://gitlab.example.com/keytec/gaia'],
      ],
      'github' => [
        'https://github.com/acme/app/issues/3',
        ['label' => 'GitHub - acme/app', 'url' => 'https://github.com/acme/app'],
      ],
      'jira cloud' => [
        'https://acme.atlassian.net/browse/BIBB-7',
        ['label' => 'Jira - BIBB', 'url' => 'https://acme.atlassian.net/browse/BIBB'],
      ],
      'jira by path' => [
        'https://jira.example.org/browse/OPS-1',
        ['label' => 'Jira - OPS', 'url' => 'https://jira.example.org/browse/OPS'],
      ],
      'any other host' => [
        'https://tracker.example.org/x/1',
        ['label' => 'tracker.example.org', 'url' => 'https://tracker.example.org'],
      ],
      'empty' => ['', NULL],
      'not a url' => ['not a url', NULL],
      'mailto' => ['mailto:a@b.c', NULL],
      'ftp' => ['ftp://gitlab.example.com/a/b/-/issues/1', NULL],
      'no host' => ['https://', NULL],
      'gitlab without an issue path' => [
        'https://gitlab.example.com/',
        ['label' => 'gitlab.example.com', 'url' => 'https://gitlab.example.com'],
      ],
    ];
  }

}
