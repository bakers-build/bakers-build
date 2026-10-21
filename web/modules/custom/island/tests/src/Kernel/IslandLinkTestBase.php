<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\island\IslandInterface;

/**
 * Shared surface for the two link-builder suites.
 *
 * Both of them render through the real pipeline rather than asserting the
 * build array, for a reason this module has already been bitten by: a link
 * element's markup is written by Link::preRenderLink(), which folds
 * `#attributes` into `#options['attributes']` before asking the link generator
 * for the finished HTML. A build-array assertion can therefore be green while
 * the anchor that reaches the browser carries nothing at all.
 */
abstract class IslandLinkTestBase extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['system', 'user', 'island', 'island_test'];

  /**
   * Renders one fixture island through the real render pipeline.
   *
   * @param string $island_id
   *   The island plugin id.
   *
   * @return string
   *   The rendered markup.
   */
  protected function renderIsland(string $island_id): string {
    $host = $this->container->get('island_test.host');
    $manager = $this->container->get('plugin.manager.island');
    $island = $manager->createInstance($island_id, ['contexts' => ['host' => $host]]);
    self::assertInstanceOf(IslandInterface::class, $island);
    // RendererInterface::renderInIsolation() takes its build BY REFERENCE, so
    // the array has to be a variable rather than the result of a call.
    $build = $island->build();
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

}
