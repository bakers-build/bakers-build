<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A row's leading avatar: the entity's image, else its initials.
 *
 * Attached to the always-present name, not to `image`, so an entity without
 * an image still renders its initials; formatting the empty image field would
 * render nothing. The image is shown only when both the field and the file may
 * be viewed, through its square `avatar` crop, and its access and cache
 * metadata bubble.
 */
#[FieldFormatter(
  id: 'bb_entity_avatar',
  label: new TranslatableMarkup('Avatar: image or initials'),
  description: new TranslatableMarkup("The entity's image as a compact avatar, falling back to initials drawn from this name."),
  field_types: ['string'],
)]
final class BbEntityAvatarFormatter extends FormatterBase {

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
    $instance = new static(
      $plugin_id,
      $plugin_definition,
      $configuration['field_definition'],
      $configuration['settings'],
      $configuration['label'],
      $configuration['view_mode'],
      $configuration['third_party_settings'],
    );
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $entity = $items->getEntity();
    $name = trim((string) $items->first()?->get('value')->getValue());
    if ($name === '') {
      return [];
    }
    $cache = new CacheableMetadata();
    $picture = $this->entityImageUrl($entity, $cache, $this->entityTypeManager);

    $element = [
      '#type' => 'component',
      '#component' => 'bb_theme:person',
      '#props' => [
        'variant' => 'compact',
        'size' => 'md',
        'initials' => $this->personInitials($name),
        'color' => $this->personColor((int) $entity->id()),
        'picture' => $picture,
        'image_fit' => 'contain',
      ],
    ];
    $cache->applyTo($element);
    return [0 => $element];
  }

}
