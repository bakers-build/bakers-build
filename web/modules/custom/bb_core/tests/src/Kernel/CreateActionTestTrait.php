<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\ui_patterns\SourcePluginBase;

/**
 * Renders the shipped create-action source on the current screen.
 */
trait CreateActionTestTrait {

  /**
   * One dialog local action's trigger on the current screen.
   *
   * Built as the shell page header builds it: `bb_create_action` with no
   * settings, so the action's `appears_on` decides whether it is there.
   *
   * @param string $action
   *   The local action id, e.g. `bb_core.create.project`.
   *
   * @return array<string, mixed>
   *   The trigger with the source's cache metadata, or the metadata alone
   *   when the screen does not offer it.
   */
  protected function createTrigger(string $action): array {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_create_action', SourcePluginBase::buildConfiguration('actions', $definition, ['source' => []], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    $build = $source->getPropValue();
    return ($build[$action] ?? []) + ['#cache' => $build['#cache']];
  }

}
