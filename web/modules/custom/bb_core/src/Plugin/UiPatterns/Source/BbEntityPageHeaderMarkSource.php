<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Plugin\Field\FieldFormatter\EntityImageTrait;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Compact project or group mark for the shell page header leading slot.
 *
 * Empty on every screen that is not a project or group place, so the title
 * row stays unchanged there.
 */
#[Source(
  id: 'bb_entity_page_header_mark',
  label: new TranslatableMarkup('[bakers.build] Entity page header mark'),
  description: new TranslatableMarkup('The project or group image beside the page title.'),
  prop_types: ['slot'],
)]
final class BbEntityPageHeaderMarkSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  use EntityImageTrait;
  use PersonIdentityTrait;

  /**
   * Loads the avatar image style.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $entity = $this->routeMatch->getParameter('bb_project') ?? $this->routeMatch->getParameter('bb_group');
    if (!$entity instanceof ContentEntityInterface || $entity->isNew()) {
      return [];
    }
    $name = trim((string) $entity->label());
    $cache = new CacheableMetadata();
    $picture = $this->entityImageUrl($entity, $cache, $this->entityTypeManager);
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:person',
      '#props' => [
        'variant' => 'compact',
        'size' => 'md',
        'initials' => $this->personInitials($name),
        'color' => $this->personColor((int) $entity->id()),
        'image_fit' => 'contain',
        'picture' => $picture,
      ],
    ];
    $cache->addCacheableDependency($entity)
      ->addCacheContexts(['url.path'])
      ->applyTo($build);
    return $build;
  }

}
