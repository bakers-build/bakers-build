<?php

declare(strict_types=1);

namespace Drupal\bb_core;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\DependencyInjection\ServiceProviderBase;
use Drupal\bb_core\JsonApi\BbResourceTypeRepository;
use Drupal\bb_core\Storage\PreviewSampleEntityGenerator;

/**
 * Supplies the optional JSON:API and UI Patterns service implementations.
 *
 * A class swap rather than a decorator, because the method that has to change
 * — ResourceTypeRepository::createResourceType() — is protected and a decorator
 * cannot reach it. Drupal discovers this class by name: it must stay
 * <CamelCasedModuleName>ServiceProvider in the module's top-level namespace.
 */
final class BbCoreServiceProvider extends ServiceProviderBase {

  /**
   * {@inheritdoc}
   */
  public function alter(ContainerBuilder $container): void {
    if ($container->hasDefinition('ui_patterns.sample_entity_generator')) {
      $container->getDefinition('ui_patterns.sample_entity_generator')
        ->setClass(PreviewSampleEntityGenerator::class);
    }
    if (!$container->hasDefinition('jsonapi.resource_type.repository')) {
      // The jsonapi module is optional; nothing to do when it is absent.
      return;
    }
    $container->getDefinition('jsonapi.resource_type.repository')
      ->setClass(BbResourceTypeRepository::class);
  }

}
