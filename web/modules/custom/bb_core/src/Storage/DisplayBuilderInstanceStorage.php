<?php

declare(strict_types=1);

namespace Drupal\bb_core\Storage;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\Context\ContextDefinitionInterface;
use Drupal\Core\Plugin\Context\EntityContext;
use Drupal\display_builder\InstanceStorage;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Stores sample identities instead of their generated reference graphs.
 */
final class DisplayBuilderInstanceStorage extends InstanceStorage {

  /**
   * Creates lightweight sample placeholders.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): self {
    $instance = parent::createInstance($container, $entity_type);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function doSave($id, EntityInterface $entity): bool|int {
    /** @var \Drupal\display_builder\Entity\Instance $entity */
    $contexts = $entity->contexts;
    try {
      foreach ($contexts as $key => $context) {
        if (!$context instanceof EntityContext) {
          continue;
        }
        $sample = $context->getContextValue();
        if ($sample->id()) {
          continue;
        }
        $bundle_key = $sample->getEntityType()->getKey('bundle');
        $values = $bundle_key ? [$bundle_key => $sample->bundle()] : [];
        $placeholder = $this->entityTypeManager->getStorage($sample->getEntityTypeId())->create($values);
        // Instance::refreshContexts() regenerates samples using type/bundle.
        $definition = $context->getContextDefinition();
        assert($definition instanceof ContextDefinitionInterface);
        $entity->contexts[$key] = new ($context::class)($definition, $placeholder);
        $entity->contexts[$key]->addCacheableDependency($context);
      }
      return parent::doSave($id, $entity);
    }
    finally {
      // Keep the caller's live preview and its field values untouched.
      $entity->contexts = $contexts;
    }
  }

}
