<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Entity\EntityFormBuilderInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\ContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Form\ReadOnlyEntityFormInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Places a standard entity form for the entity in the component context.
 */
#[Source(
  id: 'entity_form',
  label: new TranslatableMarkup('Entity form'),
  description: new TranslatableMarkup('A configured operation of the current entity.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new ContextDefinition('entity', label: new TranslatableMarkup('Entity'), required: TRUE),
  ],
)]
final class EntityFormSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Builds the entity's configured form operation.
   */
  protected EntityFormBuilderInterface $entityFormBuilder;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityFormBuilder = $container->get('entity.form_builder');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $form['operation'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Form operation'),
      '#default_value' => $this->getSetting('operation') ?? 'default',
      '#required' => TRUE,
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $entity = $this->getContextValue('entity');
    if (!$entity instanceof EntityInterface || $entity->isNew()) {
      return [];
    }
    $operation = $this->getSetting('operation') ?? 'default';
    $form_class = $entity->getEntityType()->getFormClass($operation);
    $access = $entity->access('update', NULL, TRUE);
    if ($form_class !== NULL && is_subclass_of($form_class, ReadOnlyEntityFormInterface::class)) {
      $access = $entity->access('view', NULL, TRUE);
    }
    $build = $access->isAllowed()
      ? $this->entityFormBuilder->getForm($entity, $operation)
      : [];
    CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($access)->addCacheableDependency($entity)->applyTo($build);
    return $build;
  }

}
