<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Plugin\DefaultPluginManager;
use Drupal\island\Attribute\Island;

/**
 * Island plugin manager.
 */
final class IslandPluginManager extends DefaultPluginManager implements IslandPluginManagerInterface {

  public function __construct(\Traversable $namespaces, CacheBackendInterface $cache_backend, ModuleHandlerInterface $module_handler) {
    parent::__construct('Plugin/Island', $namespaces, $module_handler, IslandInterface::class, Island::class);
    $this->alterInfo('island_info');
    $this->setCacheBackend($cache_backend, 'island_plugins');
  }

  /**
   * {@inheritdoc}
   */
  protected function findDefinitions(): array {
    $definitions = parent::findDefinitions();
    foreach ($definitions as $plugin_id => $plugin_definition) {
      foreach (($plugin_definition['modules'] ?? []) as $module) {
        if (!$this->moduleHandler->moduleExists($module)) {
          unset($definitions[$plugin_id]);
        }
      }
    }
    return $definitions;
  }

}
