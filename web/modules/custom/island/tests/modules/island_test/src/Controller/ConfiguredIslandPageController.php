<?php

declare(strict_types=1);

namespace Drupal\island_test\Controller;

use Drupal\Core\DependencyInjection\ContainerInjectionInterface;
use Drupal\ui_patterns\SourcePluginManager;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A page built the way the shell page layout builds one (BB-396 D5).
 *
 * The shell itself is a `display_builder_page_layout.page_layout.*` config
 * entity, and a kernel test cannot install one: `PageLayout::postSave()`
 * dereferences the display_builder profile it names, which is the fatal
 * `ShellPageLayoutTabRoutesTest` documents at length. So this fixture keeps the
 * part the property is about — two CONFIGURATION-MODE island containers built
 * by the real `island` ui_patterns source, one wrapping the other's target —
 * and drops the part that only positions them.
 *
 * It goes through `SourcePluginManager::getSource()` rather than calling
 * `IslandWrapper::wrap()` directly, and that is the whole point of the fixture:
 * calling the wrapper would test the wrapper, which is already tested. What is
 * unproven is the SOURCE, on a real request, twice.
 */
final class ConfiguredIslandPageController implements ContainerInjectionInterface {

  /**
   * The html id of the container every link on the page replaces.
   */
  public const CONTENT_ID = 'island-content';

  /**
   * The html id of the rail, which targets the content island.
   */
  public const RAIL_ID = 'island-rail';

  public function __construct(
    private readonly SourcePluginManager $sourcesManager,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static($container->get('plugin.manager.ui_patterns_source'));
  }

  /**
   * The shell: a rail beside a content island, both from configuration.
   *
   * @return array<string, mixed>
   *   A render array in the shape the page layout's two slots produce.
   */
  public function page(): array {
    return [
      'sidebar' => $this->island(self::RAIL_ID, '#' . self::CONTENT_ID),
      // The content island targets ITSELF — an empty swap target — because it
      // is already the main fragment and cannot ride along with itself.
      'content' => $this->island(self::CONTENT_ID, ''),
    ];
  }

  /**
   * One configuration-mode island wrapping the sentinel block.
   *
   * @param string $island_id
   *   The container's DOM id.
   * @param string $swap_target
   *   The CSS selector the links inside it replace, or '' for itself.
   *
   * @return array<string, mixed>
   *   The island container render array.
   */
  private function island(string $island_id, string $swap_target): array {
    $source = $this->sourcesManager->getSource('content', [], [
      'source_id' => 'island',
      'source' => [
        'island_id' => $island_id,
        'swap_target' => $swap_target,
        'content' => [
          [
            'source_id' => 'block',
            'source' => ['plugin_id' => 'island_test_sentinel'],
          ],
        ],
      ],
    ], []);
    if ($source === NULL) {
      return [];
    }
    $build = $source->getPropValue();
    return is_array($build) ? $build : [];
  }

}
