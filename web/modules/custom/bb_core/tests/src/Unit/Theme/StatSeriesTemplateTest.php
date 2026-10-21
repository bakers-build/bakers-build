<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit\Theme;

use Drupal\Core\Template\Attribute;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Twig\Environment;
use Twig\Loader\FilesystemLoader;
use Twig\TwigFunction;

/**
 * The stat-series template scales its bars and escapes its provenance.
 */
#[Group('bb_core')]
final class StatSeriesTemplateTest extends UnitTestCase {

  /**
   * Renders the template for one series of daily counts.
   *
   * @param int[] $counts
   *   The daily counts, oldest first.
   */
  private function render(array $counts): string {
    $twig = new Environment(new FilesystemLoader(
      dirname(__DIR__, 7) . '/themes/custom/bb_theme/components/stat-series',
    ), ['autoescape' => 'html']);
    $twig->addFunction(new TwigFunction('create_attribute', fn () => new Attribute()));
    $days = array_map(fn (int $count) => ['date' => '2026-09-24', 'label' => 'Thu', 'count' => $count], $counts);
    return $twig->render('stat-series.twig', [
      'label' => 'Daily tickets',
      'days' => $days,
      'source' => '<script>unsafe</script>',
    ]);
  }

  /**
   * Series and the bar heights they must produce.
   *
   * @return array<string, array{int[], string[]}>
   *   Counts and the expected heights.
   */
  public static function series(): array {
    return [
      'bars share one scale' => [[0, 1, 4], ['0', '25', '100']],
      'an all-zero series stays flat' => [[0, 0, 0], ['0', '0', '0']],
    ];
  }

  /**
   * Series retain their scale, readable labels and escaped provenance.
   *
   * @param int[] $counts
   *   The daily counts.
   * @param string[] $heights
   *   The expected bar heights.
   */
  #[DataProvider('series')]
  public function testBarsScaleToTheLargestValue(array $counts, array $heights): void {
    $html = $this->render($counts);
    preg_match_all('/<rect[^>]* height="([^"]+)"/', $html, $matches);
    self::assertSame($heights, $matches[1]);
    self::assertSame(3, substr_count($html, '<time '));
    self::assertStringNotContainsString('<script>', $html);
  }

}
