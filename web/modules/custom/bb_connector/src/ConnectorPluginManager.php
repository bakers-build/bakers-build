<?php

declare(strict_types=1);

namespace Drupal\bb_connector;

use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Plugin\DefaultPluginManager;
use Drupal\bb_connector\Attribute\BbConnectorPlugin;

/**
 * Manages discovery of bakers.build connector plugins.
 */
final class ConnectorPluginManager extends DefaultPluginManager {

  /**
   * Constructs a ConnectorPluginManager.
   */
  public function __construct(\Traversable $namespaces, CacheBackendInterface $cache_backend, ModuleHandlerInterface $module_handler) {
    parent::__construct(
      'Plugin/BbConnector',
      $namespaces,
      $module_handler,
      ConnectorPluginInterface::class,
      BbConnectorPlugin::class,
    );
    $this->alterInfo('bb_connector_plugin_info');
    $this->setCacheBackend($cache_backend, 'bb_connector_plugins');
  }

}
