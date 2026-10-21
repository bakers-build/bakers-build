<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\File\FileUrlGeneratorInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\file\FileInterface;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The three `person` props a `user` entity carries but no field states.
 *
 * `initials` and `color` are derived as `BbPersonCellFormatter` derives
 * them, so one account has one mark everywhere. `picture` needs the `avatar`
 * image style URL, which no `field_property` source can reach. All five
 * props go through this one source: mixing it with generic sources left
 * props empty at render time.
 *.
 */
#[Source(
  id: 'bb_user_person_props',
  label: new TranslatableMarkup('[bakers.build] Person props from a user'),
  description: new TranslatableMarkup('Every `person` prop for the `user.user.compact` mapping, derived from one account.'),
  prop_types: ['string', 'enum', 'variant'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:user', label: new TranslatableMarkup('User'), required: TRUE),
  ],
)]
final class BbUserPersonPropsSource extends SourcePluginBase {

  use PersonIdentityTrait;

  private const string PROP_VARIANT = 'variant';
  private const string PROP_SIZE = 'size';
  private const string PROP_DISPLAY_NAME = 'display_name';
  private const string PROP_INITIALS = 'initials';
  private const string PROP_COLOR = 'color';
  private const string PROP_PICTURE = 'picture';

  /**
   * The entity type manager, injected in `create()`.
   *
   * `BbRunRowSource`'s pattern: `SourcePluginBase::__construct()` already
   * takes ten arguments, so restating them to add an eleventh here would be
   * the copy that rots when contrib adds one of its own.
   */
  private EntityTypeManagerInterface $entityTypeManager;

  /**
   * The URL generator, for the fallback path when no `avatar` style exists.
   */
  private FileUrlGeneratorInterface $fileUrlGenerator;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    $instance->fileUrlGenerator = $container->get('file_url_generator');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function alterComponent(array $element): array {
    $element = parent::alterComponent($element);
    $account = $this->account();
    if ($account === NULL) {
      return $element;
    }
    $cache = CacheableMetadata::createFromRenderArray($element);
    $cache->addCacheableDependency($account);
    $cache->applyTo($element);
    return $element;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $account = $this->account();
    if ($account === NULL) {
      return '';
    }

    return match ($this->getPropId()) {
      self::PROP_VARIANT => 'compact',
      self::PROP_SIZE => 'sm',
      self::PROP_DISPLAY_NAME => $this->personDisplayName($account),
      self::PROP_INITIALS => $this->personInitials((string) $account->label()),
      self::PROP_COLOR => $this->personColor((int) $account->id()),
      self::PROP_PICTURE => $this->pictureUrl($account),
      default => '',
    };
  }

  /**
   * The account's profile picture, styled through `avatar`, or empty.
   */
  private function pictureUrl(UserInterface $account): string {
    if (!$account->hasField('user_picture') || $account->get('user_picture')->isEmpty()) {
      return '';
    }
    $file = $account->get('user_picture')->entity;
    if (!$file instanceof FileInterface) {
      return '';
    }
    $style = $this->entityTypeManager->getStorage('image_style')->load('avatar');
    return $style !== NULL
      ? $style->buildUrl($file->getFileUri())
      : $this->fileUrlGenerator->generateAbsoluteString($file->getFileUri());
  }

  /**
   * The user this source is rendering, or NULL off a user.
   */
  private function account(): ?UserInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof UserInterface ? $entity : NULL;
  }

}
