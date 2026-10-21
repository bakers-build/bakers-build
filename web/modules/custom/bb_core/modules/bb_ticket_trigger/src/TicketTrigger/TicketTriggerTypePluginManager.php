<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\TicketTrigger;

use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Plugin\DefaultPluginManager;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_ticket_trigger\Attribute\BbTicketTriggerType;

/**
 * Discovers ticket trigger types (`Plugin/BbTicketTriggerType`).
 */
final class TicketTriggerTypePluginManager extends DefaultPluginManager {

  /**
   * Constructs a TicketTriggerTypePluginManager.
   */
  public function __construct(\Traversable $namespaces, CacheBackendInterface $cache_backend, ModuleHandlerInterface $module_handler) {
    parent::__construct(
      'Plugin/BbTicketTriggerType',
      $namespaces,
      $module_handler,
      BbTicketTriggerTypeInterface::class,
      BbTicketTriggerType::class,
    );
    $this->alterInfo('bb_ticket_trigger_type_info');
    $this->setCacheBackend($cache_backend, 'bb_ticket_trigger_type_plugins');
  }

  /**
   * {@inheritdoc}
   *
   * A stored trigger whose type's module is gone still loads: the Plugin
   * module instantiates the stored ID on load, and a throw there would make
   * the trigger, its list row and its runtime record unreachable. The stand-in
   * keeps the stored ID and configuration, so a save writes them back intact.
   *
   * @param string $plugin_id
   *   The plugin ID.
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   */
  public function createInstance($plugin_id, array $configuration = []): BbTicketTriggerTypeInterface {
    if (!$this->hasDefinition($plugin_id)) {
      return new UnavailableTriggerType($configuration, $plugin_id, [
        'id' => $plugin_id,
        'label' => new TranslatableMarkup('Unavailable trigger type: @id', ['@id' => $plugin_id]),
        'scheduled' => FALSE,
        'class' => UnavailableTriggerType::class,
        'provider' => 'bb_core',
      ]);
    }
    $instance = parent::createInstance($plugin_id, $configuration);
    assert($instance instanceof BbTicketTriggerTypeInterface);
    return $instance;
  }

}
