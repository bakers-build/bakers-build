<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\TicketTrigger;

use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Plugin\DefaultPluginManager;
use Drupal\bb_ticket_trigger\Attribute\BbTicketTriggerTarget;

/**
 * Discovers ticket trigger targets (`Plugin/BbTicketTriggerTarget`).
 *
 * Each target is a bundle of `bb_ticket_trigger` (the Entity module's
 * bundle plugins).
 */
final class TicketTriggerTargetPluginManager extends DefaultPluginManager {

  /**
   * Constructs a TicketTriggerTargetPluginManager.
   */
  public function __construct(\Traversable $namespaces, CacheBackendInterface $cache_backend, ModuleHandlerInterface $module_handler) {
    parent::__construct(
      'Plugin/BbTicketTriggerTarget',
      $namespaces,
      $module_handler,
      BbTicketTriggerTargetInterface::class,
      BbTicketTriggerTarget::class,
    );
    $this->alterInfo('bb_ticket_trigger_target_info');
    $this->setCacheBackend($cache_backend, 'bb_ticket_trigger_target_plugins');
  }

}
