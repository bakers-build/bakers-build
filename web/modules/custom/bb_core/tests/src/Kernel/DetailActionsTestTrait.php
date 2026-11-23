<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\EntityInterface;
use Drupal\ui_patterns\SourcePluginBase;

/**
 * Builds a detail screen's footer actions source for an entity.
 */
trait DetailActionsTestTrait {

  /**
   * The footer's buttons, keyed by action, without render metadata.
   *
   * @return array<string, array<string, mixed>>
   *   The action render arrays.
   */
  protected function detailActions(string $source_id, EntityInterface $entity): array {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance($source_id, SourcePluginBase::buildConfiguration('footer', $definition, ['source' => []], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    $source->setContextValue('entity', $entity);
    $build = $source->getPropValue();
    self::assertIsArray($build);
    return array_filter($build, static fn ($key): bool => !str_starts_with((string) $key, '#'), ARRAY_FILTER_USE_KEY);
  }

}
